use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("2xynrcTArXh3Vk4rKvMqeKKM6d1eJWgkPG3z7hKKxXZF");

#[program]
pub mod token_vault {
    use super::*;

    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault_config = &mut ctx.accounts.vault_config;

        vault_config.admin = ctx.accounts.admin.key();
        vault_config.mint = ctx.accounts.mint.key();
        vault_config.vault_token_account = ctx.accounts.vault_token_account.key();
        vault_config.vault_authority_bump = ctx.bumps.vault_authority;
        vault_config.config_bump = ctx.bumps.vault_config;
        vault_config.paused = false;

        Ok(())
    }

    #[derive(Accounts)]
    pub struct InitializePosition<'info> {
        #[account(
            seeds = [b"vault_config", mint.key().as_ref()],
            bump = vault_config.config_bump,
            has_one = mint
        )]
        pub vault_config: Account<'info, VaultConfig>,

        #[account(
            init,
            payer = user,
            space = 8 + VaultConfig::INIT_SPACE,
            seeds = [b"user_position", user.key().as_ref(), mint.key().as_ref()],
            bump
        )]
        pub user_position: Account<'info, UserPosition>,

        pub mint: Account<'info, Mint>,

        #[account(mut)]
        pub user: Signer<'info>,

        pub system_program: Program<'info, System>,
    }

    pub fn initialize_position(ctx: Context<InitializePosition>) -> Result<()> {
        let user_position = &mut ctx.accounts.user_position;

        user_position.user = ctx.accounts.user.key();
        user_position.mint = ctx.accounts.vault_config.mint.key();
        user_position.deposited_amount = 0;
        user_position.bump = ctx.bumps.user_position;

        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        let vault_config = &ctx.accounts.vault_config;

        require!(!vault_config.paused, VaultError::Paused);

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, amount)?;

        let user_position = &mut ctx.accounts.user_position;

        user_position.deposited_amount = user_position
            .deposited_amount
            .checked_add(amount)
            .ok_or(VaultError::MathOverflow)?; 

        Ok(())
    }

    pub fn pause_vault(ctx: Context<VaultAdminAction>) -> Result<()> {
        let vault_config = &mut ctx.accounts.vault_config;

        vault_config.paused = true;

        Ok(())    
    }

    pub fn unpause_vault(ctx: Context<VaultAdminAction>) -> Result<()> {
        let vault_config = &mut ctx.accounts.vault_config;

        vault_config.paused = false;

        Ok(())
    }

    pub fn admin_withdraw(ctx: Context<AdminWithdraw>, amount: u64) -> Result<()> {
        let vault_config = &ctx.accounts.vault_config;

        require!(!vault_config.paused, VaultError::Paused);

        let user_position = &mut ctx.accounts.user_position;

        require!(
            user_position.deposited_amount >= amount,  
            VaultError::InsufficientPositionBalance
        );

        user_position.deposited_amount = user_position
            .deposited_amount
            .checked_sub(amount)
            .ok_or(VaultError::MathOverflow)?;

        let mint_key = ctx.accounts.mint.key();
        
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_authority",
            mint_key.as_ref(),
            &[vault_config.vault_authority_bump],
        ]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts,
            signer_seeds,
        );

        token::transfer(cpi_ctx, amount)?;
        
        Ok(())
    }

    pub fn user_withdraw(ctx: Context<UserWithdraw>, amount: u64) -> Result<()> {
        let vault_config = &ctx.accounts.vault_config;

        require!(!vault_config.paused, VaultError::Paused);

        let user_position = &mut ctx.accounts.user_position;

        require!(
            user_position.deposited_amount >= amount,  
            VaultError::InsufficientPositionBalance
        );

        user_position.deposited_amount = user_position
            .deposited_amount
            .checked_sub(amount)
            .ok_or(VaultError::MathOverflow)?;

        let mint_key = ctx.accounts.mint.key();
        
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"vault_authority",
            mint_key.as_ref(),
            &[vault_config.vault_authority_bump],
        ]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.to_account_info();

        let cpi_ctx = CpiContext::new_with_signer(
            cpi_program,
            cpi_accounts,
            signer_seeds,
        );

        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + VaultConfig::INIT_SPACE,
        seeds = [b"vault_config", mint.key().as_ref()],
        bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    /// CHECK: This PDA is only used as the token account authority.
    #[account(
        seeds = [b"vault_authority", mint.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        token::mint = mint,
        token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        seeds = [b"vault_config", mint.key().as_ref()],
        bump = vault_config.config_bump,
        has_one = mint,
        has_one = vault_token_account
    )]
    pub vault_config: Account<'info, VaultConfig>,

    /// CHECK: This PDA is only used as the token account authority.
    #[account(
        seeds = [b"vault_authority", mint.key().as_ref()],
        bump = vault_config.vault_authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"user_position", user.key().as_ref(), mint.key().as_ref()],
        bump = user_position.bump,
        has_one = user,
        has_one = mint,
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct VaultAdminAction<'info> {
    #[account(
        mut,
        seeds = [b"vault_config", vault_config.mint.as_ref()],
        bump = vault_config.config_bump,
        has_one = admin
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AdminWithdraw<'info> {
    #[account(
        seeds = [b"vault_config", mint.key().as_ref()],
        bump = vault_config.config_bump,
        has_one = admin,
        has_one = mint,
        has_one = vault_token_account
    )]
    pub vault_config: Account<'info, VaultConfig>,

    /// CHECK: This PDA is only used as the token account authority.
    #[account(
        seeds = [b"vault_authority", mint.key().as_ref()],
        bump = vault_config.vault_authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [
            b"user_position",
            recipient.key().as_ref(),
            mint.key().as_ref()
        ],
        bump = user_position.bump,
        has_one = mint,
        constraint = user_position.user == recipient.key()
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = recipient
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// CHECK: This account is only used as the recipient identity.
    pub recipient: UncheckedAccount<'info>,

    pub admin: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct UserWithdraw<'info> {
    #[account(
        seeds = [b"vault_config", mint.key().as_ref()],
        bump = vault_config.config_bump,
        has_one = mint,
        has_one = vault_token_account
    )]
    pub vault_config: Account<'info, VaultConfig>,

    /// CHECK: This PDA is only used as the token account authority.
    #[account(
        seeds = [b"vault_authority", mint.key().as_ref()],
        bump = vault_config.vault_authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        seeds = [b"user_position", user.key().as_ref(), mint.key().as_ref()],
        bump = user_position.bump,
        has_one = user,
        has_one = mint
    )]
    pub user_position: Account<'info, UserPosition>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = user
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    pub user: Signer<'info>,

    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct VaultConfig {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub vault_authority_bump: u8,
    pub config_bump: u8,
    pub paused: bool,
}

#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub deposited_amount: u64,
    pub bump: u8,
}

#[error_code]
pub enum VaultError {
    #[msg("The vault is paused.")]
    Paused,

    #[msg("Math overflow.")]
    MathOverflow,

    #[msg("Insufficient position balance.")]
    InsufficientPositionBalance,
}