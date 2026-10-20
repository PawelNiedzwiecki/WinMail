# Security Policy

WinMail is an email client. It handles mailbox credentials and message content, so security reports are taken seriously.

## Supported versions

WinMail is pre-1.0. Only the latest release (and the current `master` branch) receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub:
[Report a vulnerability](https://github.com/PawelNiedzwiecki/WinMail/security/advisories/new)

Include:
- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The WinMail version and Windows version

What to expect:
- Acknowledgement within 7 days
- A status update within 30 days
- Credit in the release notes if you want it, once a fix is out

## Scope

In scope: the WinMail application in this repository, including how it stores credentials, renders HTML email (sanitisation, remote content, links), and talks to IMAP/SMTP servers.

Out of scope: vulnerabilities in third-party mail servers, and issues that require an attacker to already have access to your Windows account.
