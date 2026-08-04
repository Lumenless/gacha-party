use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};
use ephemeral_rollups_sdk::{
    access_control::{
        instructions::CreateEphemeralPermissionCpi,
        structs::{
            EphemeralMembersArgs, EphemeralPermission, Member, PERMISSION_SEED, TX_BALANCES_FLAG,
            TX_LOGS_FLAG, TX_MESSAGE_FLAG,
        },
    },
    anchor::{commit, delegate, ephemeral},
    consts::{EPHEMERAL_VAULT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
};

declare_id!("BMKHnBM1oq1LyXFYyHq2gUdyugo1N8aGF6wtBnJNd6Nz");

pub const ROOM_SEED: &[u8] = b"party-room";
pub const ESCROW_SEED: &[u8] = b"party-escrow";
pub const ESCROW_VAULT_SEED: &[u8] = b"escrow-vault";
pub const CONTRIBUTION_SEED: &[u8] = b"contribution";
pub const PRIVATE_VOTE_SEED: &[u8] = b"private-vote";
pub const MAX_PLAYERS: usize = 4;
pub const ROOM_VERSION: u8 = 2;
pub const OPENING_LEAD_SECONDS: i64 = 4;
pub const ESCROW_VERSION: u8 = 2;
pub const CONTRIBUTION_VERSION: u8 = 1;
pub const PRIVATE_VOTE_VERSION: u8 = 1;
pub const USDC_DECIMALS: u8 = 6;
pub const MAX_PRIVATE_VOTE_WINDOW_SECONDS: i64 = 10 * 60;

#[ephemeral]
#[program]
pub mod gacha_party_room {
    use super::*;

    pub fn initialize_room(
        ctx: Context<InitializeRoom>,
        room_id: [u8; 8],
        max_players: u8,
    ) -> Result<()> {
        require!(
            (2..=MAX_PLAYERS as u8).contains(&max_players),
            RoomError::InvalidPlayerLimit
        );
        let now = Clock::get()?.unix_timestamp;
        let room = &mut ctx.accounts.room;
        room.version = ROOM_VERSION;
        room.bump = ctx.bumps.room;
        room.room_id = room_id;
        room.host = ctx.accounts.host.key();
        room.max_players = max_players;
        room.participant_count = 1;
        room.ready_mask = 0;
        room.phase = RoomPhase::Lobby;
        room.countdown_ends_at = 0;
        room.revision = 1;
        room.last_activity_at = now;
        room.participants = [Pubkey::default(); MAX_PLAYERS];
        room.participants[0] = ctx.accounts.host.key();

        emit!(RoomInitialized {
            room: room.key(),
            host: room.host,
            max_players,
            revision: room.revision,
        });
        Ok(())
    }

    pub fn join_room(ctx: Context<MutateRoom>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let room = &mut ctx.accounts.room;
        let player = ctx.accounts.player.key();
        room.join(player, now)?;

        emit!(PlayerJoined {
            room: room.key(),
            player,
            participant_count: room.participant_count,
            revision: room.revision,
        });
        Ok(())
    }

    pub fn set_ready(ctx: Context<MutateRoom>, ready: bool) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let room = &mut ctx.accounts.room;
        let player = ctx.accounts.player.key();
        room.set_player_ready(player, ready, now)?;

        emit!(ReadyChanged {
            room: room.key(),
            player,
            ready,
            ready_mask: room.ready_mask,
            revision: room.revision,
        });
        Ok(())
    }

    /// ER instruction: the host starts one authoritative room countdown after everyone is ready.
    /// The extra propagation second lets clients render the same final three-second countdown.
    pub fn start_opening(ctx: Context<MutateRoom>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let room = &mut ctx.accounts.room;
        let player = ctx.accounts.player.key();
        room.start_opening(player, now)?;

        emit!(OpeningStarted {
            room: room.key(),
            countdown_ends_at: room.countdown_ends_at,
            revision: room.revision,
        });
        Ok(())
    }

    pub fn react(ctx: Context<MutateRoom>, reaction: u8) -> Result<()> {
        require!(reaction <= Reaction::Hype as u8, RoomError::InvalidReaction);
        let now = Clock::get()?.unix_timestamp;
        let room = &mut ctx.accounts.room;
        let player = ctx.accounts.player.key();
        room.require_participant(player)?;
        room.touch(now)?;

        emit!(ReactionSent {
            room: room.key(),
            player,
            reaction,
            revision: room.revision,
        });
        Ok(())
    }

    /// Base-layer instruction: creates one voter-scoped account and pre-funds its
    /// TEE-only ephemeral permission rent. No vote choice is supplied here.
    pub fn initialize_private_vote(
        ctx: Context<InitializePrivateVote>,
        party_id: [u8; 8],
        reveal_after: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        PrivateVote::validate_reveal_after(now, reveal_after)?;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.voter.to_account_info(),
                    to: ctx.accounts.private_vote.to_account_info(),
                },
            ),
            ephemeral_rollups_sdk::ephemeral_accounts::rent(EphemeralPermission::size_of(1) as u32),
        )?;

        let private_vote = &mut ctx.accounts.private_vote;
        private_vote.version = PRIVATE_VOTE_VERSION;
        private_vote.bump = ctx.bumps.private_vote;
        private_vote.party_id = party_id;
        private_vote.voter = ctx.accounts.voter.key();
        private_vote.choice = PrivateVoteChoice::Uncast;
        private_vote.reveal_after = reveal_after;
        private_vote.cast_at = 0;
        Ok(())
    }

    /// Base-layer instruction: delegates only to MagicBlock's devnet TEE validator.
    pub fn delegate_private_vote(
        ctx: Context<DelegatePrivateVote>,
        party_id: [u8; 8],
    ) -> Result<()> {
        let voter = ctx.accounts.voter.key();
        ctx.accounts.delegate_private_vote(
            &ctx.accounts.voter,
            &[PRIVATE_VOTE_SEED, voter.as_ref(), party_id.as_ref()],
            DelegateConfig {
                validator: Some(ctx.accounts.validator.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// TEE instruction: creates the ephemeral permission as private immediately,
    /// granting transaction visibility only to the voter.
    pub fn initialize_private_vote_permission(ctx: Context<PrivateVotePermission>) -> Result<()> {
        if !ctx.accounts.permission.data_is_empty() {
            return Ok(());
        }
        let voter = ctx.accounts.private_vote.voter;
        let party_id = ctx.accounts.private_vote.party_id;
        let bump = [ctx.accounts.private_vote.bump];
        let signer_seeds = [PRIVATE_VOTE_SEED, voter.as_ref(), party_id.as_ref(), &bump];
        CreateEphemeralPermissionCpi {
            payer: ctx.accounts.private_vote.to_account_info(),
            permissioned_account: ctx.accounts.private_vote.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            vault: ctx.accounts.ephemeral_vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs {
                is_private: true,
                members: vec![Member {
                    flags: TX_LOGS_FLAG | TX_MESSAGE_FLAG | TX_BALANCES_FLAG,
                    pubkey: voter,
                }],
            },
        }
        .invoke_signed(&[&signer_seeds])?;
        Ok(())
    }

    /// TEE instruction: records a choice only after the permission exists and the
    /// authenticated voter signs. Choice values are 1 = KEEP and 2 = SELL.
    pub fn cast_private_vote(ctx: Context<CastPrivateVote>, choice: u8) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        ctx.accounts.private_vote.cast(choice, now)
    }

    /// Base-layer instruction: creates an immutable participant-scoped token escrow.
    /// The mint is supplied explicitly so deployments can select the canonical mint per cluster.
    pub fn initialize_escrow(
        ctx: Context<InitializeEscrow>,
        room_id: [u8; 8],
        funding_target: u64,
        participant_count: u8,
        participants: [Pubkey; MAX_PLAYERS],
        operator: Pubkey,
    ) -> Result<()> {
        EscrowState::validate_configuration(
            ctx.accounts.host.key(),
            funding_target,
            participant_count,
            &participants,
        )?;
        require!(operator != Pubkey::default(), EscrowError::InvalidOperator);
        require_eq!(
            ctx.accounts.mint.decimals,
            USDC_DECIMALS,
            EscrowError::InvalidMintDecimals
        );

        let escrow = &mut ctx.accounts.escrow;
        escrow.version = ESCROW_VERSION;
        escrow.bump = ctx.bumps.escrow;
        escrow.vault_bump = ctx.bumps.vault;
        escrow.room_id = room_id;
        escrow.host = ctx.accounts.host.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.vault = ctx.accounts.vault.key();
        escrow.operator = operator;
        escrow.funding_target = funding_target;
        escrow.total_contributed = 0;
        escrow.participant_count = participant_count;
        escrow.contributor_count = 0;
        escrow.status = EscrowStatus::Funding;
        escrow.purchase_signature = [0; 64];
        escrow.purchase_memo_hash = [0; 32];
        escrow.participants = participants;

        emit!(EscrowInitialized {
            escrow: escrow.key(),
            host: escrow.host,
            mint: escrow.mint,
            operator,
            funding_target,
            participant_count,
        });
        Ok(())
    }

    /// Base-layer instruction: accepts one checked token deposit from each allowed participant.
    pub fn deposit_contribution(ctx: Context<DepositContribution>, amount: u64) -> Result<()> {
        ctx.accounts.escrow.require_status(EscrowStatus::Funding)?;
        require!(amount > 0, EscrowError::InvalidContributionAmount);
        let contributor = ctx.accounts.contributor.key();
        ctx.accounts.escrow.require_participant(contributor)?;
        let next_total = ctx
            .accounts
            .escrow
            .total_contributed
            .checked_add(amount)
            .ok_or(EscrowError::AmountOverflow)?;
        require!(
            next_total <= ctx.accounts.escrow.funding_target,
            EscrowError::FundingTargetExceeded
        );

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.contributor_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.contributor.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let receipt = &mut ctx.accounts.receipt;
        receipt.version = CONTRIBUTION_VERSION;
        receipt.bump = ctx.bumps.receipt;
        receipt.escrow = ctx.accounts.escrow.key();
        receipt.contributor = contributor;
        receipt.amount = amount;

        let escrow = &mut ctx.accounts.escrow;
        escrow.total_contributed = next_total;
        escrow.contributor_count = escrow
            .contributor_count
            .checked_add(1)
            .ok_or(EscrowError::AmountOverflow)?;

        emit!(ContributionDeposited {
            escrow: escrow.key(),
            contributor,
            amount,
            total_contributed: next_total,
        });
        Ok(())
    }

    /// Base-layer instruction: contributors can recover their entire deposit until locking exists.
    pub fn refund_contribution(ctx: Context<RefundContribution>) -> Result<()> {
        ctx.accounts.escrow.require_status(EscrowStatus::Funding)?;
        let amount = ctx.accounts.receipt.amount;
        let host = ctx.accounts.escrow.host;
        let room_id = ctx.accounts.escrow.room_id;
        let bump = [ctx.accounts.escrow.bump];
        let signer_seeds: &[&[u8]] = &[ESCROW_SEED, host.as_ref(), room_id.as_ref(), &bump];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.contributor_token.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        let escrow = &mut ctx.accounts.escrow;
        escrow.total_contributed = escrow
            .total_contributed
            .checked_sub(amount)
            .ok_or(EscrowError::InvalidEscrowBalance)?;
        escrow.contributor_count = escrow
            .contributor_count
            .checked_sub(1)
            .ok_or(EscrowError::InvalidEscrowBalance)?;

        emit!(ContributionRefunded {
            escrow: escrow.key(),
            contributor: ctx.accounts.contributor.key(),
            amount,
            total_contributed: escrow.total_contributed,
        });
        Ok(())
    }

    /// Freezes a fully funded escrow. The host authorizes the point of no return.
    pub fn lock_escrow(ctx: Context<LockEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.require_status(EscrowStatus::Funding)?;
        require_eq!(
            escrow.total_contributed,
            escrow.funding_target,
            EscrowError::EscrowNotFullyFunded
        );
        require!(
            ctx.accounts.vault.amount >= escrow.funding_target,
            EscrowError::InvalidEscrowBalance
        );
        escrow.status = EscrowStatus::Locked;
        emit!(EscrowLocked {
            escrow: escrow.key(),
            funding_target: escrow.funding_target,
        });
        Ok(())
    }

    /// Releases the exact target to the immutable operator token account once.
    pub fn release_to_operator(ctx: Context<ReleaseToOperator>) -> Result<()> {
        ctx.accounts.escrow.require_status(EscrowStatus::Locked)?;
        let amount = ctx.accounts.escrow.funding_target;
        require!(
            ctx.accounts.vault.amount >= amount,
            EscrowError::InvalidEscrowBalance
        );

        let host = ctx.accounts.escrow.host;
        let room_id = ctx.accounts.escrow.room_id;
        let bump = [ctx.accounts.escrow.bump];
        let signer_seeds: &[&[u8]] = &[ESCROW_SEED, host.as_ref(), room_id.as_ref(), &bump];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.operator_token.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        ctx.accounts.escrow.status = EscrowStatus::Released;
        emit!(EscrowReleased {
            escrow: ctx.accounts.escrow.key(),
            operator: ctx.accounts.operator.key(),
            amount,
        });
        Ok(())
    }

    /// Records the confirmed Collector Crypt purchase for retry-safe orchestration.
    pub fn mark_purchased(
        ctx: Context<OperatorEscrowAction>,
        purchase_signature: [u8; 64],
        purchase_memo_hash: [u8; 32],
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.require_status(EscrowStatus::Released)?;
        require!(
            purchase_signature != [0; 64],
            EscrowError::InvalidPurchaseReference
        );
        require!(
            purchase_memo_hash != [0; 32],
            EscrowError::InvalidPurchaseReference
        );
        escrow.purchase_signature = purchase_signature;
        escrow.purchase_memo_hash = purchase_memo_hash;
        escrow.status = EscrowStatus::Purchased;
        emit!(EscrowPurchaseRecorded {
            escrow: escrow.key(),
            purchase_signature,
            purchase_memo_hash,
        });
        Ok(())
    }

    /// Final audit marker. Payout verification remains in the durable settlement orchestrator.
    pub fn mark_settled(ctx: Context<OperatorEscrowAction>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        escrow.require_status(EscrowStatus::Purchased)?;
        escrow.status = EscrowStatus::Settled;
        emit!(EscrowSettled {
            escrow: escrow.key(),
        });
        Ok(())
    }

    /// Base-layer instruction: delegates the room PDA to the selected validator.
    pub fn delegate_room(ctx: Context<DelegateRoom>, room_id: [u8; 8]) -> Result<()> {
        let payer = ctx.accounts.payer.key();
        let (expected_room, _) = Pubkey::find_program_address(
            &[ROOM_SEED, payer.as_ref(), room_id.as_ref()],
            &crate::ID,
        );
        require_keys_eq!(
            ctx.accounts.pda.key(),
            expected_room,
            RoomError::InvalidRoomPda
        );

        ctx.accounts.delegate_pda(
            &ctx.accounts.payer,
            &[ROOM_SEED, payer.as_ref(), room_id.as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|account| account.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// ER instruction: atomically schedules the latest room revision for base-layer commit.
    pub fn commit_room(ctx: Context<CommitRoom>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.room.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// ER instruction: commits the room and returns ownership to this program on the base layer.
    pub fn undelegate_room(ctx: Context<CommitRoom>) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.room.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(room_id: [u8; 8])]
pub struct InitializeRoom<'info> {
    #[account(
        init,
        payer = host,
        space = 8 + RoomState::INIT_SPACE,
        seeds = [ROOM_SEED, host.key().as_ref(), room_id.as_ref()],
        bump,
    )]
    pub room: Account<'info, RoomState>,
    #[account(mut)]
    pub host: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MutateRoom<'info> {
    #[account(
        mut,
        seeds = [ROOM_SEED, room.host.as_ref(), room.room_id.as_ref()],
        bump = room.bump,
    )]
    pub room: Account<'info, RoomState>,
    pub player: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(party_id: [u8; 8])]
pub struct InitializePrivateVote<'info> {
    #[account(
        init,
        payer = voter,
        space = 8 + PrivateVote::INIT_SPACE,
        seeds = [PRIVATE_VOTE_SEED, voter.key().as_ref(), party_id.as_ref()],
        bump,
    )]
    pub private_vote: Account<'info, PrivateVote>,
    #[account(mut)]
    pub voter: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(party_id: [u8; 8])]
pub struct DelegatePrivateVote<'info> {
    pub voter: Signer<'info>,
    /// CHECK: The macro validates the program-derived account before delegation.
    #[account(
        mut,
        del,
        seeds = [PRIVATE_VOTE_SEED, voter.key().as_ref(), party_id.as_ref()],
        bump,
    )]
    pub private_vote: UncheckedAccount<'info>,
    /// CHECK: Privacy fails closed to MagicBlock's published devnet TEE validator.
    #[account(address = pubkey!("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"))]
    pub validator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct PrivateVotePermission<'info> {
    pub voter: Signer<'info>,
    #[account(
        mut,
        seeds = [PRIVATE_VOTE_SEED, private_vote.voter.as_ref(), private_vote.party_id.as_ref()],
        bump = private_vote.bump,
        has_one = voter @ RoomError::NotPrivateVoter,
    )]
    pub private_vote: Account<'info, PrivateVote>,
    /// CHECK: PDA and owning Permission Program are constrained explicitly.
    #[account(
        mut,
        seeds = [PERMISSION_SEED, private_vote.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
    )]
    pub permission: UncheckedAccount<'info>,
    /// CHECK: Fixed MagicBlock Permission Program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    /// CHECK: Fixed MagicBlock ephemeral rent vault.
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub ephemeral_vault: UncheckedAccount<'info>,
    /// CHECK: Fixed MagicBlock program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CastPrivateVote<'info> {
    pub voter: Signer<'info>,
    #[account(
        mut,
        seeds = [PRIVATE_VOTE_SEED, private_vote.voter.as_ref(), private_vote.party_id.as_ref()],
        bump = private_vote.bump,
        has_one = voter @ RoomError::NotPrivateVoter,
    )]
    pub private_vote: Account<'info, PrivateVote>,
    /// CHECK: Its PDA proves that the permission corresponds to this vote account.
    #[account(
        seeds = [PERMISSION_SEED, private_vote.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID,
        owner = PERMISSION_PROGRAM_ID @ RoomError::PrivatePermissionRequired,
    )]
    pub permission: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(
    room_id: [u8; 8],
    funding_target: u64,
    participant_count: u8,
    participants: [Pubkey; MAX_PLAYERS],
    operator: Pubkey
)]
pub struct InitializeEscrow<'info> {
    #[account(
        init,
        payer = host,
        space = 8 + EscrowState::INIT_SPACE,
        seeds = [ESCROW_SEED, host.key().as_ref(), room_id.as_ref()],
        bump,
    )]
    pub escrow: Account<'info, EscrowState>,
    #[account(
        init,
        payer = host,
        seeds = [ESCROW_VAULT_SEED, escrow.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = escrow,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(constraint = mint.decimals == USDC_DECIMALS @ EscrowError::InvalidMintDecimals)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub host: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositContribution<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.host.as_ref(), escrow.room_id.as_ref()],
        bump = escrow.bump,
        has_one = mint @ EscrowError::InvalidEscrowMint,
        has_one = vault @ EscrowError::InvalidEscrowVault,
    )]
    pub escrow: Account<'info, EscrowState>,
    #[account(
        init,
        payer = contributor,
        space = 8 + ContributionReceipt::INIT_SPACE,
        seeds = [CONTRIBUTION_SEED, escrow.key().as_ref(), contributor.key().as_ref()],
        bump,
    )]
    pub receipt: Account<'info, ContributionReceipt>,
    #[account(
        mut,
        constraint = contributor_token.mint == mint.key() @ EscrowError::InvalidEscrowMint,
        constraint = contributor_token.owner == contributor.key() @ EscrowError::InvalidTokenOwner,
    )]
    pub contributor_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault.mint == mint.key() @ EscrowError::InvalidEscrowMint,
        constraint = vault.owner == escrow.key() @ EscrowError::InvalidTokenOwner,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub contributor: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundContribution<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.host.as_ref(), escrow.room_id.as_ref()],
        bump = escrow.bump,
        has_one = mint @ EscrowError::InvalidEscrowMint,
        has_one = vault @ EscrowError::InvalidEscrowVault,
    )]
    pub escrow: Account<'info, EscrowState>,
    #[account(
        mut,
        close = contributor,
        seeds = [CONTRIBUTION_SEED, escrow.key().as_ref(), contributor.key().as_ref()],
        bump = receipt.bump,
        has_one = escrow @ EscrowError::InvalidContributionReceipt,
        has_one = contributor @ EscrowError::InvalidContributionReceipt,
    )]
    pub receipt: Account<'info, ContributionReceipt>,
    #[account(
        mut,
        constraint = contributor_token.mint == mint.key() @ EscrowError::InvalidEscrowMint,
        constraint = contributor_token.owner == contributor.key() @ EscrowError::InvalidTokenOwner,
    )]
    pub contributor_token: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault.mint == mint.key() @ EscrowError::InvalidEscrowMint,
        constraint = vault.owner == escrow.key() @ EscrowError::InvalidTokenOwner,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub contributor: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct LockEscrow<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.host.as_ref(), escrow.room_id.as_ref()],
        bump = escrow.bump,
        has_one = host @ EscrowError::HostRequired,
        has_one = vault @ EscrowError::InvalidEscrowVault,
    )]
    pub escrow: Account<'info, EscrowState>,
    #[account(
        constraint = vault.owner == escrow.key() @ EscrowError::InvalidTokenOwner,
        constraint = vault.mint == escrow.mint @ EscrowError::InvalidEscrowMint,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub host: Signer<'info>,
}

#[derive(Accounts)]
pub struct ReleaseToOperator<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.host.as_ref(), escrow.room_id.as_ref()],
        bump = escrow.bump,
        has_one = mint @ EscrowError::InvalidEscrowMint,
        has_one = vault @ EscrowError::InvalidEscrowVault,
        has_one = operator @ EscrowError::InvalidOperator,
    )]
    pub escrow: Account<'info, EscrowState>,
    #[account(
        mut,
        constraint = vault.owner == escrow.key() @ EscrowError::InvalidTokenOwner,
        constraint = vault.mint == mint.key() @ EscrowError::InvalidEscrowMint,
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = operator_token.owner == operator.key() @ EscrowError::InvalidTokenOwner,
        constraint = operator_token.mint == mint.key() @ EscrowError::InvalidEscrowMint,
    )]
    pub operator_token: Account<'info, TokenAccount>,
    pub mint: Account<'info, Mint>,
    pub operator: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct OperatorEscrowAction<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED, escrow.host.as_ref(), escrow.room_id.as_ref()],
        bump = escrow.bump,
        has_one = operator @ EscrowError::InvalidOperator,
    )]
    pub escrow: Account<'info, EscrowState>,
    pub operator: Signer<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: The handler re-derives this PDA from payer and room_id before invoking delegation.
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitRoom<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        constraint = room.host == payer.key() @ RoomError::HostRequired,
        seeds = [ROOM_SEED, room.host.as_ref(), room.room_id.as_ref()],
        bump = room.bump,
    )]
    pub room: Account<'info, RoomState>,
}

#[account]
#[derive(InitSpace, Debug, PartialEq)]
pub struct RoomState {
    pub version: u8,
    pub bump: u8,
    pub room_id: [u8; 8],
    pub host: Pubkey,
    pub max_players: u8,
    pub participant_count: u8,
    pub ready_mask: u8,
    pub phase: RoomPhase,
    pub countdown_ends_at: i64,
    pub revision: u64,
    pub last_activity_at: i64,
    pub participants: [Pubkey; MAX_PLAYERS],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum RoomPhase {
    Lobby,
    Opening,
}

#[account]
#[derive(InitSpace, Debug, PartialEq)]
pub struct EscrowState {
    pub version: u8,
    pub bump: u8,
    pub vault_bump: u8,
    pub room_id: [u8; 8],
    pub host: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub operator: Pubkey,
    pub funding_target: u64,
    pub total_contributed: u64,
    pub participant_count: u8,
    pub contributor_count: u8,
    pub status: EscrowStatus,
    pub purchase_signature: [u8; 64],
    pub purchase_memo_hash: [u8; 32],
    pub participants: [Pubkey; MAX_PLAYERS],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum EscrowStatus {
    Funding,
    Locked,
    Released,
    Purchased,
    Settled,
}

impl EscrowState {
    fn validate_configuration(
        host: Pubkey,
        funding_target: u64,
        participant_count: u8,
        participants: &[Pubkey; MAX_PLAYERS],
    ) -> Result<()> {
        require!(funding_target > 0, EscrowError::InvalidFundingTarget);
        require!(
            (2..=MAX_PLAYERS as u8).contains(&participant_count),
            EscrowError::InvalidParticipantCount
        );
        require_keys_eq!(
            participants[0],
            host,
            EscrowError::HostMustBeFirstParticipant
        );

        for index in 0..MAX_PLAYERS {
            if index < participant_count as usize {
                require!(
                    participants[index] != Pubkey::default(),
                    EscrowError::InvalidParticipant
                );
                require!(
                    !participants[..index].contains(&participants[index]),
                    EscrowError::DuplicateParticipant
                );
            } else {
                require!(
                    participants[index] == Pubkey::default(),
                    EscrowError::InvalidParticipant
                );
            }
        }
        Ok(())
    }

    fn require_participant(&self, contributor: Pubkey) -> Result<()> {
        require!(
            self.participants[..self.participant_count as usize].contains(&contributor),
            EscrowError::NotEscrowParticipant
        );
        Ok(())
    }

    fn require_status(&self, expected: EscrowStatus) -> Result<()> {
        require!(self.status == expected, EscrowError::InvalidEscrowStatus);
        Ok(())
    }
}

#[account]
#[derive(InitSpace, Debug, PartialEq)]
pub struct ContributionReceipt {
    pub version: u8,
    pub bump: u8,
    pub escrow: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
}

#[account]
#[derive(InitSpace, Debug, PartialEq)]
pub struct PrivateVote {
    pub version: u8,
    pub bump: u8,
    pub party_id: [u8; 8],
    pub voter: Pubkey,
    pub choice: PrivateVoteChoice,
    pub reveal_after: i64,
    pub cast_at: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, InitSpace, PartialEq, Eq)]
pub enum PrivateVoteChoice {
    Uncast,
    Keep,
    Sell,
}

impl PrivateVote {
    fn validate_reveal_after(now: i64, reveal_after: i64) -> Result<()> {
        let maximum = now
            .checked_add(MAX_PRIVATE_VOTE_WINDOW_SECONDS)
            .ok_or(RoomError::TimestampOverflow)?;
        require!(
            reveal_after > now && reveal_after <= maximum,
            RoomError::InvalidPrivateVoteDeadline
        );
        Ok(())
    }

    fn cast(&mut self, choice: u8, now: i64) -> Result<()> {
        let next = match choice {
            1 => PrivateVoteChoice::Keep,
            2 => PrivateVoteChoice::Sell,
            _ => return err!(RoomError::InvalidPrivateVoteChoice),
        };
        if self.choice == next {
            return Ok(());
        }
        require!(
            self.choice == PrivateVoteChoice::Uncast,
            RoomError::PrivateVoteAlreadyCast
        );
        require!(now <= self.reveal_after, RoomError::PrivateVoteClosed);
        self.choice = next;
        self.cast_at = now;
        Ok(())
    }
}

impl RoomState {
    fn participant_index(&self, player: Pubkey) -> Option<usize> {
        self.participants[..self.participant_count as usize]
            .iter()
            .position(|participant| *participant == player)
    }

    fn require_participant(&self, player: Pubkey) -> Result<usize> {
        self.participant_index(player)
            .ok_or_else(|| error!(RoomError::NotParticipant))
    }

    fn touch(&mut self, now: i64) -> Result<()> {
        self.revision = self
            .revision
            .checked_add(1)
            .ok_or(RoomError::RevisionOverflow)?;
        self.last_activity_at = now;
        Ok(())
    }

    fn join(&mut self, player: Pubkey, now: i64) -> Result<()> {
        self.require_lobby()?;
        require!(
            self.participant_index(player).is_none(),
            RoomError::AlreadyJoined
        );
        require!(
            (self.participant_count as usize) < self.max_players as usize,
            RoomError::RoomFull
        );
        let index = self.participant_count as usize;
        self.participants[index] = player;
        self.participant_count = self
            .participant_count
            .checked_add(1)
            .ok_or(RoomError::RoomFull)?;
        self.touch(now)
    }

    fn set_player_ready(&mut self, player: Pubkey, ready: bool, now: i64) -> Result<()> {
        self.require_lobby()?;
        let index = self.require_participant(player)?;
        let bit = 1u8
            .checked_shl(index as u32)
            .ok_or(RoomError::InvalidReadyIndex)?;
        self.ready_mask = if ready {
            self.ready_mask | bit
        } else {
            self.ready_mask & !bit
        };
        self.touch(now)
    }

    fn require_lobby(&self) -> Result<()> {
        require!(self.phase == RoomPhase::Lobby, RoomError::RoomNotInLobby);
        Ok(())
    }

    fn start_opening(&mut self, player: Pubkey, now: i64) -> Result<()> {
        require_keys_eq!(self.host, player, RoomError::HostRequired);
        self.require_lobby()?;
        require!(self.everyone_ready(), RoomError::EveryoneMustBeReady);
        self.countdown_ends_at = now
            .checked_add(OPENING_LEAD_SECONDS)
            .ok_or(RoomError::TimestampOverflow)?;
        self.phase = RoomPhase::Opening;
        self.touch(now)
    }

    pub fn everyone_ready(&self) -> bool {
        let expected = (1u8 << self.participant_count) - 1;
        self.participant_count > 0 && self.ready_mask & expected == expected
    }
}

#[repr(u8)]
pub enum Reaction {
    Fire = 0,
    Shock = 1,
    Laugh = 2,
    Hype = 3,
}

#[event]
pub struct RoomInitialized {
    pub room: Pubkey,
    pub host: Pubkey,
    pub max_players: u8,
    pub revision: u64,
}

#[event]
pub struct PlayerJoined {
    pub room: Pubkey,
    pub player: Pubkey,
    pub participant_count: u8,
    pub revision: u64,
}

#[event]
pub struct ReadyChanged {
    pub room: Pubkey,
    pub player: Pubkey,
    pub ready: bool,
    pub ready_mask: u8,
    pub revision: u64,
}

#[event]
pub struct ReactionSent {
    pub room: Pubkey,
    pub player: Pubkey,
    pub reaction: u8,
    pub revision: u64,
}

#[event]
pub struct OpeningStarted {
    pub room: Pubkey,
    pub countdown_ends_at: i64,
    pub revision: u64,
}

#[event]
pub struct EscrowInitialized {
    pub escrow: Pubkey,
    pub host: Pubkey,
    pub mint: Pubkey,
    pub operator: Pubkey,
    pub funding_target: u64,
    pub participant_count: u8,
}

#[event]
pub struct ContributionDeposited {
    pub escrow: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub total_contributed: u64,
}

#[event]
pub struct ContributionRefunded {
    pub escrow: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub total_contributed: u64,
}

#[event]
pub struct EscrowLocked {
    pub escrow: Pubkey,
    pub funding_target: u64,
}

#[event]
pub struct EscrowReleased {
    pub escrow: Pubkey,
    pub operator: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EscrowPurchaseRecorded {
    pub escrow: Pubkey,
    pub purchase_signature: [u8; 64],
    pub purchase_memo_hash: [u8; 32],
}

#[event]
pub struct EscrowSettled {
    pub escrow: Pubkey,
}

#[error_code]
pub enum RoomError {
    #[msg("Player limit must be between two and four.")]
    InvalidPlayerLimit,
    #[msg("This wallet already joined the room.")]
    AlreadyJoined,
    #[msg("The room is full.")]
    RoomFull,
    #[msg("Only room participants can perform this action.")]
    NotParticipant,
    #[msg("The reaction code is not supported.")]
    InvalidReaction,
    #[msg("The room revision overflowed.")]
    RevisionOverflow,
    #[msg("The ready-state participant index is invalid.")]
    InvalidReadyIndex,
    #[msg("The supplied room PDA is invalid.")]
    InvalidRoomPda,
    #[msg("Only the room host can commit or undelegate it.")]
    HostRequired,
    #[msg("The room is no longer accepting membership or ready-state changes.")]
    RoomNotInLobby,
    #[msg("Every current room participant must be ready before opening.")]
    EveryoneMustBeReady,
    #[msg("The opening timestamp overflowed.")]
    TimestampOverflow,
    #[msg("The private vote deadline must be in the next ten minutes.")]
    InvalidPrivateVoteDeadline,
    #[msg("Private vote choices must be KEEP or SELL.")]
    InvalidPrivateVoteChoice,
    #[msg("Only the private vote owner can perform this action.")]
    NotPrivateVoter,
    #[msg("Create the TEE permission before casting a private vote.")]
    PrivatePermissionRequired,
    #[msg("This private vote already contains a different choice.")]
    PrivateVoteAlreadyCast,
    #[msg("The private voting deadline has passed.")]
    PrivateVoteClosed,
}

#[error_code]
pub enum EscrowError {
    #[msg("The funding target must be greater than zero.")]
    InvalidFundingTarget,
    #[msg("The escrow participant count must be between two and four.")]
    InvalidParticipantCount,
    #[msg("The host must be the first escrow participant.")]
    HostMustBeFirstParticipant,
    #[msg("Escrow participants must be non-empty and unused slots must be empty.")]
    InvalidParticipant,
    #[msg("Each escrow participant wallet must be unique.")]
    DuplicateParticipant,
    #[msg("Only an escrow participant can contribute.")]
    NotEscrowParticipant,
    #[msg("Contribution amount must be greater than zero.")]
    InvalidContributionAmount,
    #[msg("This contribution would exceed the funding target.")]
    FundingTargetExceeded,
    #[msg("Token amount arithmetic overflowed.")]
    AmountOverflow,
    #[msg("The escrow mint does not use six decimals.")]
    InvalidMintDecimals,
    #[msg("The supplied token mint does not match the escrow.")]
    InvalidEscrowMint,
    #[msg("The supplied token vault does not match the escrow.")]
    InvalidEscrowVault,
    #[msg("The supplied token account has an invalid owner.")]
    InvalidTokenOwner,
    #[msg("The contribution receipt does not belong to this signer and escrow.")]
    InvalidContributionReceipt,
    #[msg("The escrow balance accounting is inconsistent.")]
    InvalidEscrowBalance,
    #[msg("The escrow operator is invalid.")]
    InvalidOperator,
    #[msg("Only the escrow host can perform this action.")]
    HostRequired,
    #[msg("The escrow is not in the required lifecycle state.")]
    InvalidEscrowStatus,
    #[msg("The escrow must be fully funded before it can be locked.")]
    EscrowNotFullyFunded,
    #[msg("The purchase signature or memo reference is invalid.")]
    InvalidPurchaseReference,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn room(host: Pubkey, max_players: u8) -> RoomState {
        let mut participants = [Pubkey::default(); MAX_PLAYERS];
        participants[0] = host;
        RoomState {
            version: ROOM_VERSION,
            bump: 255,
            room_id: *b"ROOM0001",
            host,
            max_players,
            participant_count: 1,
            ready_mask: 0,
            phase: RoomPhase::Lobby,
            countdown_ends_at: 0,
            revision: 1,
            last_activity_at: 100,
            participants,
        }
    }

    #[test]
    fn joins_unique_players_up_to_the_limit() {
        let host = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let mut state = room(host, 2);

        state.join(player, 101).unwrap();
        assert_eq!(state.participant_count, 2);
        assert_eq!(state.revision, 2);
        assert!(state.join(player, 102).is_err());
        assert!(state.join(Pubkey::new_unique(), 102).is_err());
    }

    #[test]
    fn ready_mask_tracks_each_participant() {
        let host = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let mut state = room(host, 2);
        state.join(player, 101).unwrap();

        state.set_player_ready(host, true, 102).unwrap();
        assert!(!state.everyone_ready());
        state.set_player_ready(player, true, 103).unwrap();
        assert!(state.everyone_ready());
        state.set_player_ready(host, false, 104).unwrap();
        assert!(!state.everyone_ready());
    }

    #[test]
    fn rejects_non_participant_ready_updates() {
        let mut state = room(Pubkey::new_unique(), 4);
        assert!(state
            .set_player_ready(Pubkey::new_unique(), true, 101)
            .is_err());
        assert_eq!(state.ready_mask, 0);
        assert_eq!(state.revision, 1);
    }

    #[test]
    fn only_ready_host_can_start_opening_once() {
        let host = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let mut state = room(host, 2);
        state.join(player, 101).unwrap();

        assert!(state.start_opening(host, 102).is_err());
        state.set_player_ready(host, true, 103).unwrap();
        state.set_player_ready(player, true, 104).unwrap();
        assert!(state.start_opening(player, 105).is_err());

        state.start_opening(host, 106).unwrap();
        assert_eq!(state.phase, RoomPhase::Opening);
        assert_eq!(state.countdown_ends_at, 106 + OPENING_LEAD_SECONDS);
        assert!(state.start_opening(host, 107).is_err());
        assert!(state.set_player_ready(host, false, 107).is_err());
        assert!(state.join(Pubkey::new_unique(), 107).is_err());
    }

    #[test]
    fn private_vote_deadline_and_choice_are_fail_closed() {
        assert!(PrivateVote::validate_reveal_after(100, 100).is_err());
        assert!(PrivateVote::validate_reveal_after(100, 101).is_ok());
        assert!(PrivateVote::validate_reveal_after(100, 701).is_err());

        let mut vote = PrivateVote {
            version: PRIVATE_VOTE_VERSION,
            bump: 1,
            party_id: *b"ROOM0001",
            voter: Pubkey::new_unique(),
            choice: PrivateVoteChoice::Uncast,
            reveal_after: 200,
            cast_at: 0,
        };
        assert!(vote.cast(0, 150).is_err());
        vote.cast(2, 150).unwrap();
        assert_eq!(vote.choice, PrivateVoteChoice::Sell);
        assert_eq!(vote.cast_at, 150);
        assert!(vote.cast(2, 151).is_ok());
        assert!(vote.cast(1, 151).is_err());
    }

    #[test]
    fn escrow_configuration_requires_a_unique_static_roster() {
        let host = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let valid = [host, player, Pubkey::default(), Pubkey::default()];
        assert!(EscrowState::validate_configuration(host, 10_000_000, 2, &valid).is_ok());

        let duplicate = [host, host, Pubkey::default(), Pubkey::default()];
        assert!(EscrowState::validate_configuration(host, 10_000_000, 2, &duplicate).is_err());

        let dirty_unused_slot = [host, player, Pubkey::new_unique(), Pubkey::default()];
        assert!(
            EscrowState::validate_configuration(host, 10_000_000, 2, &dirty_unused_slot).is_err()
        );
    }

    #[test]
    fn escrow_configuration_rejects_invalid_targets_and_hosts() {
        let host = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let participants = [host, player, Pubkey::default(), Pubkey::default()];
        assert!(EscrowState::validate_configuration(host, 0, 2, &participants).is_err());
        assert!(EscrowState::validate_configuration(player, 1_000_000, 2, &participants).is_err());
    }

    #[test]
    fn escrow_membership_uses_only_active_roster_entries() {
        let host = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let outsider = Pubkey::new_unique();
        let state = EscrowState {
            version: ESCROW_VERSION,
            bump: 1,
            vault_bump: 2,
            room_id: *b"ROOM0001",
            host,
            mint: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            operator: Pubkey::new_unique(),
            funding_target: 10_000_000,
            total_contributed: 0,
            participant_count: 2,
            contributor_count: 0,
            status: EscrowStatus::Funding,
            purchase_signature: [0; 64],
            purchase_memo_hash: [0; 32],
            participants: [host, player, Pubkey::default(), Pubkey::default()],
        };
        assert!(state.require_participant(host).is_ok());
        assert!(state.require_participant(player).is_ok());
        assert!(state.require_participant(outsider).is_err());
    }

    #[test]
    fn escrow_lifecycle_rejects_replays() {
        let host = Pubkey::new_unique();
        let player = Pubkey::new_unique();
        let mut state = EscrowState {
            version: ESCROW_VERSION,
            bump: 1,
            vault_bump: 2,
            room_id: *b"ROOM0002",
            host,
            mint: Pubkey::new_unique(),
            vault: Pubkey::new_unique(),
            operator: Pubkey::new_unique(),
            funding_target: 10_000_000,
            total_contributed: 10_000_000,
            participant_count: 2,
            contributor_count: 2,
            status: EscrowStatus::Funding,
            purchase_signature: [0; 64],
            purchase_memo_hash: [0; 32],
            participants: [host, player, Pubkey::default(), Pubkey::default()],
        };

        assert!(state.require_status(EscrowStatus::Funding).is_ok());
        state.status = EscrowStatus::Locked;
        assert!(state.require_status(EscrowStatus::Funding).is_err());
        assert!(state.require_status(EscrowStatus::Locked).is_ok());
        state.status = EscrowStatus::Released;
        assert!(state.require_status(EscrowStatus::Locked).is_err());
    }
}
