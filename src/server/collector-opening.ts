import type { Party } from "@/domain/party";
import { CollectorCryptOpeningPendingError } from "@/integrations/collector-crypt/real";
import type { CollectorCryptAdapter, OpeningResult } from "@/integrations/collector-crypt/types";
import { signCollectorCryptTransaction, getGachaOperatorSigner } from "./gacha-operator";
import {
  createCollectorOperation,
  updateCollectorOperation,
  type CollectorOperation,
} from "./collector-operation";
import { markPartyEscrowPurchased, releasePartyEscrowToOperator } from "./operator-escrow";

export async function executeRealCollectorOpening(
  party: Party,
  collectorCrypt: CollectorCryptAdapter,
): Promise<OpeningResult> {
  const claim = await createCollectorOperation(party.id);
  let operation = claim.operation;
  if (operation.opening) return operation.opening;
  if (!claim.created && operation.status === "PROCESSING" && recentlyUpdated(operation)) {
    throw new CollectorCryptOpeningPendingError();
  }

  try {
    const operator = await getGachaOperatorSigner();
    const pack = (await collectorCrypt.listPacks()).find((candidate) => candidate.code === party.packCode);
    if (!pack?.isOpen) throw new Error("The selected Collector Crypt pack is no longer available.");
    if (pack.priceBaseUnits !== BigInt(party.fundingTargetBaseUnits)) {
      throw new Error("The live Collector Crypt pack price no longer matches the escrow target.");
    }

    if (!operation.releaseSignature) {
      const releaseSignature = await releasePartyEscrowToOperator(party);
      operation = await updateCollectorOperation(party.id, {
        status: "RELEASED",
        releaseSignature: releaseSignature ?? "confirmed-onchain",
        error: null,
      });
    }

    if (!operation.memo || !operation.preparedTransaction) {
      const prepared = await collectorCrypt.preparePurchase({
        playerAddress: operator.address,
        packCode: party.packCode,
        cardRecipient: operator.address,
      });
      operation = await updateCollectorOperation(party.id, {
        status: "PREPARED",
        memo: prepared.memo,
        preparedTransaction: prepared.transactionBase64,
        error: null,
      });
    }

    if (!operation.purchaseSignature) {
      const signed = await signCollectorCryptTransaction(required(operation.preparedTransaction, "prepared transaction"));
      const submitted = await collectorCrypt.submitPurchase(signed);
      operation = await updateCollectorOperation(party.id, {
        status: "SUBMITTED",
        purchaseSignature: submitted.signature,
        purchaseConfirmationStatus: submitted.confirmationStatus,
        error: null,
      });
    }

    if (!operation.purchaseMarkerSignature) {
      const marker = await markPartyEscrowPurchased(
        party,
        required(operation.purchaseSignature, "purchase signature"),
        required(operation.memo, "purchase memo"),
      );
      operation = await updateCollectorOperation(party.id, {
        status: "PURCHASED",
        purchaseMarkerSignature: marker ?? "confirmed-onchain",
        error: null,
      });
    }

    const opening = await collectorCrypt.openPack(required(operation.memo, "purchase memo"));
    await updateCollectorOperation(party.id, { status: "OPENED", opening, error: null });
    return opening;
  } catch (error) {
    if (error instanceof CollectorCryptOpeningPendingError) throw error;
    await updateCollectorOperation(party.id, {
      status: "FAILED",
      error: error instanceof Error ? error.message : "Collector Crypt opening failed.",
    });
    throw error;
  }
}

function recentlyUpdated(operation: CollectorOperation): boolean {
  return Date.now() - new Date(operation.updatedAt).getTime() < 30_000;
}

function required(value: string | null, label: string): string {
  if (!value) throw new Error(`The durable Collector Crypt ${label} is missing.`);
  return value;
}
