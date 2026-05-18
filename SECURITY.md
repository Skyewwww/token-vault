# Security Policy

This document describes the security assumptions, account validation rules, and known limitations of the Solana Token Vault program.

## Security Goals

The program is designed to ensure that:

- Only valid vault accounts can be used.
- Only the vault authority PDA can authorize vault token transfers.
- Users can only withdraw up to their own recorded position balance.
- Admin operations cannot bypass user accounting.
- Closed position accounts must be empty.
- Paused vaults reject sensitive operations.
- Attackers cannot use another user's `UserPosition`.

## Account Model

The protocol uses the following critical accounts:

```text
VaultConfig PDA:
  Stores vault configuration and admin state.

VaultAuthority PDA:
  Controls the vault token account.

VaultTokenAccount:
  Stores the actual SPL Token balance of the vault.

UserPosition PDA:
  Stores each user's deposited amount for a specific mint.

UserTokenAccount:
  Stores the user's SPL Token balance.
```

## PDA Validation

The program validates PDAs using deterministic seeds and bumps.

### VaultConfig PDA

Seeds:

```text
["vault_config", mint]
```

Security purpose:

- Prevents arbitrary config accounts from being passed.
- Binds a vault config to a specific mint.
- Stores the current admin, mint, vault token account, bumps, and paused status.

### VaultAuthority PDA

Seeds:

```text
["vault_authority", mint]
```

Security purpose:

- Ensures the vault token account authority is controlled by the program.
- Prevents users or admins from directly signing vault token transfers.
- Allows the program to authorize SPL Token CPI transfers through signer seeds.

### UserPosition PDA

Seeds:

```text
["user_position", user, mint]
```

Security purpose:

- Ensures each user has an isolated position for each mint.
- Prevents attackers from using another user's position.
- Prevents cross-mint accounting confusion.

## Token Account Validation

The program validates token accounts with Anchor token constraints.

Common checks include:

```rust
token::mint = mint
token::authority = user
```

or, for recipient-based admin withdrawal:

```rust
token::authority = recipient
```

Security purpose:

- Prevents users from passing token accounts for the wrong mint.
- Prevents users from passing token accounts controlled by another wallet.
- Prevents admin delegated withdrawal from deducting one user's position while sending tokens to another user's token account.

## Vault Token Account

The vault token account is designed to be the Associated Token Account of:

```text
owner = vault_authority PDA
mint = vault mint
```

Security purpose:

- Makes the vault token account deterministic.
- Ensures vault assets are controlled by the program authority PDA.
- Prevents arbitrary token accounts from being used as the vault.

## Position Accounting

The vault token account holds total vault assets, but user balances are tracked separately by `UserPosition`.

The program must never rely only on:

```text
vault_token_account.amount
```

to determine how much a user can withdraw.

Instead, withdrawals are restricted by:

```rust
user_position.deposited_amount >= amount
```

Security purpose:

- Prevents one user from withdrawing another user's funds.
- Keeps user-level accounting explicit.
- Ensures both `userWithdraw` and `adminWithdraw` obey the same balance rules.

## Deposit Security

During deposit:

```text
user_token_account -> vault_token_account
```

The program checks:

- Vault is not paused.
- User position belongs to the signer.
- User token account uses the correct mint.
- User token account is controlled by the user.
- Vault token account belongs to the vault.

Accounting update:

```text
user_position.deposited_amount += amount
```

Risk mitigated:

- Wrong mint deposit
- Wrong token account authority
- Incorrect position account
- Deposit while paused

## User Withdraw Security

During user withdrawal:

```text
vault_token_account -> user_token_account
```

The program checks:

- Vault is not paused.
- User position belongs to the signer.
- User token account uses the correct mint.
- User token account is controlled by the user.
- Withdraw amount does not exceed `user_position.deposited_amount`.

Accounting update:

```text
user_position.deposited_amount -= amount
```

The SPL Token transfer is authorized by the `vault_authority` PDA through signer seeds.

Risk mitigated:

- Over-withdraw
- Attacker using another user's position
- Wrong recipient token account
- Withdrawal while paused

## Admin Withdraw Security

`adminWithdraw` allows the admin to withdraw on behalf of a recipient.

This is not an unrestricted admin sweep. It must still obey recipient accounting.

During admin withdrawal:

```text
vault_token_account -> recipient_token_account
```

The program checks:

- Caller is the current admin.
- Vault is not paused.
- Recipient position belongs to the recipient.
- Recipient token account is controlled by the recipient.
- Withdraw amount does not exceed recipient position balance.

Accounting update:

```text
recipient_position.deposited_amount -= amount
```

Risk mitigated:

- Admin bypassing position accounting
- Non-admin delegated withdrawal
- Deducting Alice's position while sending tokens to Bob
- Over-withdraw by admin
- Admin withdrawal while paused

## Pause / Unpause Security

Admin can pause or unpause the vault.

When paused, sensitive operations are blocked:

- `deposit`
- `userWithdraw`
- `adminWithdraw`

Security purpose:

- Emergency stop mechanism
- Allows admin to halt user-facing operations during incidents
- Prevents further movement while investigating abnormal behavior

## Transfer Admin Security

`transferAdmin` updates the vault admin.

Security checks:

- Current admin must sign.
- `vault_config.admin` must match the signer.
- New admin is stored as a public key.

After transfer:

```text
old admin loses admin permissions
new admin gains admin permissions
```

Risk mitigated:

- Unauthorized admin transfer
- Old admin continuing to perform admin actions after transfer

## Close Position Security

`closePosition` allows a user to close an empty `UserPosition`.

Close condition:

```text
user_position.deposited_amount == 0
```

Security purpose:

- Prevents users from deleting accounting state while still having a recorded balance.
- Ensures rent can only be reclaimed after the position is empty.
- Ensures users can only close their own position.

Risk mitigated:

- Closing non-empty position
- Attacker closing another user's position
- Losing accounting state for active deposits

## Arithmetic Safety

The program should use checked arithmetic for balance updates.

Examples:

```rust
checked_add
checked_sub
```

Security purpose:

- Prevents integer overflow.
- Prevents underflow during withdrawal.
- Ensures accounting state remains valid.

## Current Test Coverage

The test suite includes coverage for:

- Vault initialization
- User position initialization
- Deposit success
- User withdraw success
- Admin withdraw success
- Pause and unpause
- Deposit failure while paused
- Withdraw failure while paused
- Over-withdraw failure
- Non-admin admin action failure
- Attacker attempting to withdraw with another user's position
- Closing non-empty position failure
- Closing empty position success
- Admin transfer
- Old admin permission loss
- New admin permission activation

## Recommended Additional Tests

Future security tests can include:

- Wrong mint failure
- Wrong user token account authority failure
- Wrong vault token account failure
- Wrong vault authority failure
- Double initialize position failure
- Attacker closing another user's position
- Admin transfer by non-admin failure
- Old admin attempting `adminWithdraw` after transfer
- Multi-user isolation tests
- Multi-mint isolation tests

## Known Limitations

This project is an educational and portfolio-oriented vault implementation.

Current limitations:

- No formal audit has been performed.
- No production deployment assumptions are made.
- No oracle integration is currently used.
- No compute unit optimization report is included yet.
- No Raydium, Jupiter, or Pyth integration is included yet.
- User token accounts may be validated by mint and authority instead of being strictly forced to ATA in every instruction, depending on the current code version.

## Future Security Improvements

Planned improvements:

- Add more negative tests for wrong mint and wrong authority.
- Add event logs for deposit and withdrawal operations.
- Add multi-user and multi-mint tests.
- Add compute unit benchmarks.
- Add devnet deployment documentation.
- Add oracle-based checks with Pyth.
- Add swap integration through Jupiter or Raydium.
- Add clearer upgrade and admin key management documentation.
