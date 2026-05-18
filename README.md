# Solana Token Vault

A Solana Token Vault program built with Rust and Anchor.

This project implements an SPL Token vault with PDA-based authority control and user-level accounting. Users can deposit tokens into a program-controlled vault, withdraw their own deposited tokens, and close empty position accounts. The vault also supports admin-controlled pause/unpause, admin-delegated withdrawal, and admin transfer.

## Overview

This project demonstrates core Solana smart contract development concepts:

- Anchor program development
- Solana account model
- Program Derived Addresses (PDAs)
- PDA as data account
- PDA as token authority
- SPL Token Program CPI
- PDA signer with `CpiContext::new_with_signer`
- Associated Token Account (ATA) integration
- User-level position accounting
- Admin permission control
- Safe account closing
- Security-oriented test design

The vault uses a program-derived `vault_authority` PDA to control the vault token account. User balances are not inferred only from the vault token account balance. Instead, each user has a dedicated `UserPosition` PDA that records the user's deposited amount for a specific mint.

## Core Account Model

### VaultConfig PDA

`VaultConfig` stores the vault configuration.

```rust
pub struct VaultConfig {
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub vault_authority_bump: u8,
    pub config_bump: u8,
    pub paused: bool,
}
```

PDA seeds:

```text
["vault_config", mint]
```

Purpose:

- Stores the current admin address
- Stores the vault mint
- Stores the vault token account address
- Stores PDA bumps
- Stores the paused status

`VaultConfig` does not store SPL tokens. It only stores vault configuration.

### VaultAuthority PDA

`VaultAuthority` is a PDA used as the token authority of the vault token account.

PDA seeds:

```text
["vault_authority", mint]
```

Purpose:

- Controls the vault token account
- Signs SPL Token CPI transfers through PDA signer seeds
- Does not need to store custom data

When tokens are withdrawn from the vault, the program uses:

```rust
CpiContext::new_with_signer(...)
```

with the vault authority seeds so that the PDA can authorize the SPL Token transfer.

### Vault Token Account

The vault token account stores the actual SPL token balance of the vault.

In the current design, the vault token account is an Associated Token Account of:

```text
owner = vault_authority PDA
mint = vault mint
```

Conceptually:

```text
vault_token_account:
  mint = vault mint
  authority = vault_authority PDA
  amount = total tokens held by the vault
```

### UserPosition PDA

`UserPosition` records a user's deposited balance for a specific mint.

```rust
pub struct UserPosition {
    pub user: Pubkey,
    pub mint: Pubkey,
    pub deposited_amount: u64,
    pub bump: u8,
}
```

PDA seeds:

```text
["user_position", user, mint]
```

Purpose:

- Tracks how many tokens a user has deposited
- Prevents users from withdrawing more than their own deposited amount
- Separates accounting between different users and different mints

Example:

```text
Alice + USDC -> Alice's USDC UserPosition
Bob + USDC   -> Bob's USDC UserPosition
Alice + BONK -> Alice's BONK UserPosition
```

## Instructions

### initializeVault

Initializes the vault for a specific mint.

Creates or initializes:

- `VaultConfig` PDA
- `VaultAuthority` PDA
- Vault token account as ATA of `vault_authority`

Main effects:

```text
vault_config.admin = admin
vault_config.mint = mint
vault_config.vault_token_account = vault_token_account
vault_config.paused = false
```

### initializePosition

Initializes a user's `UserPosition` PDA.

Main effects:

```text
user_position.user = user
user_position.mint = mint
user_position.deposited_amount = 0
user_position.bump = bump
```

### deposit

Allows a user to deposit tokens into the vault.

Token flow:

```text
user_token_account -> vault_token_account
```

Accounting flow:

```text
user_position.deposited_amount += amount
```

Important checks:

- Vault must not be paused
- User position must belong to the signer
- User token account must have the correct mint
- User token account must be controlled by the user
- Vault token account must match the vault config and vault authority

### userWithdraw

Allows a user to withdraw their own deposited tokens.

Token flow:

```text
vault_token_account -> user_token_account
```

Accounting flow:

```text
user_position.deposited_amount -= amount
```

Important checks:

- Vault must not be paused
- User position must belong to the signer
- Withdraw amount must not exceed `user_position.deposited_amount`
- Vault authority PDA signs the SPL Token transfer

### adminWithdraw

Allows the admin to withdraw on behalf of a recipient.

Token flow:

```text
vault_token_account -> recipient_token_account
```

Accounting flow:

```text
recipient_position.deposited_amount -= amount
```

This instruction does not allow the admin to bypass user accounting. The admin can only withdraw up to the recipient's recorded position balance.

Important checks:

- Admin must be the current vault admin
- Vault must not be paused
- Recipient position must belong to the recipient
- Recipient token account must be controlled by the recipient
- Withdraw amount must not exceed recipient position balance

### pauseVault

Allows the admin to pause the vault.

When paused, sensitive actions are rejected, including:

- `deposit`
- `userWithdraw`
- `adminWithdraw`

### unpauseVault

Allows the admin to unpause the vault.

### closePosition

Allows a user to close an empty `UserPosition`.

A position can only be closed when:

```text
user_position.deposited_amount == 0
```

When closed, rent lamports are returned to the user.

### transferAdmin

Transfers vault admin authority from the current admin to a new admin.

After transfer:

```text
old_admin can no longer perform admin actions
new_admin can perform admin actions
```

## Security Design Summary

### PDA Validation

The program validates all critical PDAs through deterministic seeds and bumps.

```text
VaultConfig:
  ["vault_config", mint]

VaultAuthority:
  ["vault_authority", mint]

UserPosition:
  ["user_position", user, mint]
```

This prevents attackers from passing arbitrary accounts in place of program-controlled accounts.

### Token Account Validation

The program validates SPL Token accounts through Anchor token constraints.

Examples:

```rust
token::mint = mint
token::authority = user
```

For the vault token account, the account is tied to the vault authority PDA and vault mint.

### Position Accounting

The vault token account stores total vault assets, while `UserPosition` stores each user's individual balance.

Withdrawals are limited by:

```rust
user_position.deposited_amount >= amount
```

This prevents one user from withdrawing tokens deposited by another user.

### Admin Permission Control

Admin-only instructions require:

```rust
has_one = admin
admin: Signer
```

This ensures that only the current admin stored in `VaultConfig` can perform admin operations.

### Pause Protection

The vault can be paused by the admin.

When paused, deposit and withdrawal operations are rejected.

### Close Position Safety

A `UserPosition` can only be closed when its deposited amount is zero.

This prevents users from deleting accounting state while still having an active balance.

## Test Coverage

The test suite covers the main success and failure paths, including:

- Vault initialization
- User position initialization
- Token deposit
- User withdraw
- Admin delegated withdraw
- Pause and unpause
- Deposit failure while paused
- Withdraw failure while paused
- Over-withdraw failure
- Non-admin admin action failure
- Attacker attempting to use another user's position
- Closing non-empty position failure
- Closing empty position success
- Admin transfer
- Old admin losing permissions
- New admin gaining permissions

## Local Development

### Install dependencies

```bash
npm install
```

### Build

```bash
anchor build
```

### Start local validator

In a separate terminal:

```bash
solana-test-validator --reset
```

### Run tests

```bash
anchor test --skip-local-validator
```

## Project Structure

```text
programs/
  token-vault/
    src/
      lib.rs

tests/
  token-vault.ts

Anchor.toml
Cargo.toml
package.json
```

## Key Concepts Practiced

This project demonstrates:

- Solana account model
- PDA derivation
- PDA as data account
- PDA as token authority
- SPL Token Program CPI
- Associated Token Account
- Anchor account constraints
- User-level accounting
- Admin permission transfer
- Close account flow
- Security-oriented test design

## Future Work

Planned improvements:

- Add more multi-user tests
- Add wrong mint / wrong authority failure tests
- Add event emission for deposit and withdraw
- Deploy to devnet
- Add Jupiter or Raydium swap integration
- Add Pyth price feed integration
- Add compute unit benchmark
- Add more detailed protocol documentation
