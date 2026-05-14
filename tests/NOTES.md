# token vault 学习笔记

## 结构
```text
VaultConfig PDA
  data = {
    admin,
    mint,
    vault_token_account,
    vault_authority_bump,
    config_bump,
    paused
  }
        |
        | records
        v
VaultTokenAccount
  mint = mint
  authority = VaultAuthority PDA
  amount = token balance
        ^
        |
        | controlled by
        |
VaultAuthority PDA
  no private key
  no data required
  Program can sign for it using seeds + bump during CPI
```

Program：
  部署在 Solana 上的可执行代码，类似智能合约。
  它有 program_id。
  它定义 instruction 的执行规则。

Account：
  链上的数据容器。
  可以是钱包、配置账户、Mint、Token Account、Program Account 等。

PDA：
  由 seeds + program_id + bump 派生出来的无私钥地址。
  它可以用来创建 data account 存状态。
  也可以只作为 authority 地址，用来让资产受 Program 规则控制。

vaultConfigPda：
  PDA + data account，存 vault 配置。

vaultAuthorityPda：
  PDA authority，不一定存数据，用来控制 vaultTokenAccount。

vaultTokenAccount：
  SPL Token Account，真正存 token 余额。


## 功能介绍
```text
initialize_vault:
  创建 VaultConfig PDA
  创建 vault_token_account
  设置 vault_token_account authority = vaultAuthorityPda
  记录 admin / mint / vault_token_account / bumps / paused

deposit:
  user_token_account -> vault_token_account
  authority = user
  user 签名
  paused 时失败

pause_vault:
  admin 把 vault_config.paused 改成 true

unpause_vault:
  admin 把 vault_config.paused 改成 false

admin_withdraw:
  vault_token_account -> user_token_account
  authority = vaultAuthorityPda
  admin 负责业务授权
  Program 用 PDA signer 代表 vaultAuthorityPda 授权 Token Program 转账

失败测试:
  paused 后 deposit 失败
  paused 后 adminWithdraw 失败
  非 admin 调用 adminWithdraw 失败
  失败后 token 余额不变
```