# 0002. Outlook reads over IMAP and sends through Microsoft Graph

Status: accepted

## Context

v1.0 needs Sign in with Microsoft for Outlook.com and Microsoft 365 accounts. WinMail is built on standard IMAP and SMTP ("standard IMAP/SMTP first so every provider benefits", SPEC.md §1). The Cache, IDLE push, incremental sync, IMAP keywords as labels, drafts and the planned Vault all depend on it.

Microsoft accepts OAuth (XOAUTH2) for IMAP. OAuth SMTP is unreliable on personal Outlook.com accounts: developers report scopes that used to work now returning `invalid_scope`, and SMTP AUTH that can't be turned on for new personal mailboxes.

Options considered:

- **IMAP and SMTP over OAuth, as for Google.** This reuses all existing code. Rejected because sending could fail for Outlook.com users, the largest group of Microsoft accounts, and WinMail has no way to fix that.
- **Microsoft Graph for everything on Outlook accounts.** This doesn't depend on IMAP, but it means a second complete mail backend: folders, delta sync instead of IDLE, categories instead of keywords, and the Cache and Vault on top of it. Rejected because it roughly doubles the mail code for one provider.
- **IMAP for reading, Graph for sending.** Chosen.

## Decision

Outlook accounts read, sync and act on mail over IMAP with XOAUTH2, exactly like every other provider. They send through Microsoft Graph (`POST /me/sendMail`, scope `Mail.Send`) instead of SMTP.

WinMail registers one app in Microsoft Entra that accepts personal and work/school accounts, as a public client using PKCE and a loopback redirect. Before building it, a one-day test confirms that IMAP with OAuth works on a personal and a work account. If it doesn't, this decision is reopened.

## Consequences

- Sending has one provider-specific path. Everything else in `mail.ts` stays provider-neutral.
- IMAP and Graph are different Microsoft resources, so each Outlook account holds two access tokens. Both come from one refresh token, and both are approved once at sign-in.
- Graph saves the sent copy to Sent itself, so WinMail must skip its own Sent upload for Outlook accounts, or the message appears twice.
- Undo send, Schedule send and Waiting for must work on top of the Graph send path, and their tests must cover it.
- Work/school tenants may need an admin to approve the app. Publisher verification in Entra removes the "unverified" label.
- If Microsoft later retires OAuth IMAP, the Graph backend we rejected comes back as the only option. We accept that risk.
