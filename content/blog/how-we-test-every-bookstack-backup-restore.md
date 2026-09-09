---
title: "How we test every BookStack backup restore"
description: "Inside Wissen’s isolated restore check: encrypted archives, HMAC authentication, book and page comparisons, and the limits of what a passing test proves."
date: "2026-09-09"
author: "Florian Standhartinger"
tags: ["BookStack", "Backups", "Operations"]
---

A backup file is evidence that something was written. It is not yet evidence that a team can recover its wiki. Wissen has an automated restore-check procedure that rebuilds a BookStack instance in a temporary, isolated stack. The title describes the checks performed whenever we run that procedure: **we do not currently restore-test every daily backup automatically**. We have tested a demo restore, and the implementation is public in our [operations documentation](https://github.com/fstandhartinger/bookstack-ops/tree/main/ops/provisioner).

## Start with a consistent backup

Our backup job is scheduled daily. It briefly stops the selected team’s BookStack application, takes a consistent MariaDB dump and archives the application files, uploads and configuration. It also saves the deployment definition and a small set of content measurements for later comparison. The application then resumes; an already stopped tenant stays stopped. The interruption matters because a database and its uploaded files need to describe the same wiki.

Local retention is **seven elapsed days**, based on UTC backup dates, rather than a fixed number of archives. A separate daily retention pass also covers stopped tenants. These are implementation details documented in the [backup and retention procedure](https://github.com/fstandhartinger/bookstack-ops/blob/main/ops/provisioner/README.md), not a promise of continuous recovery to any moment between backups.

## Encrypt, then authenticate before restoring

The preferred format uses **age** to encrypt the combined archive with a generated random passphrase. The implementation also supports an OpenSSL fallback using AES-256-CBC with PBKDF2 and salt when age is unavailable. In both cases, a keyed SHA-256 authentication file, or **HMAC**, accompanies the encrypted archive. The restore procedure verifies it before attempting decryption. A missing or mismatched authentication file causes the check to fail.

Encryption limits who can read an archive; authentication checks that its bytes match what the key holder signed. Neither replaces key management. Recovery requires the separately preserved backup key as well as the archive and its authentication file. We keep credentials out of command-line arguments and logs, and remove temporary plaintext staging after the operation. See the [backup implementation](https://github.com/fstandhartinger/bookstack-ops/blob/main/ops/provisioner/tenant.py).

## Rebuild away from the running wiki

The restore command creates a uniquely named temporary deployment using the saved configuration and container images. It removes public routing labels, shared public networks and exposed ports from that deployment. It restores application files and imports the database before starting BookStack. The live tenant is not replaced by this test.

Using the backed-up images keeps the exercise focused on recovery of that version. It avoids quietly turning a restore check into an application or database upgrade. Once the checks finish, cleanup removes the temporary stack and its files, including when the operation fails.

## Compare content before and after startup

The script compares restored **page count, book count, book titles and the latest page title** against the measurements saved with the backup. It checks those values both before and after application startup and verifies database migrations. That can catch an empty import, missing records or a startup that changes the expected content. The [restore-test entry point](https://github.com/fstandhartinger/bookstack-ops/blob/main/ops/provisioner/restore-test.sh) invokes this shared restore implementation.

A passing check has limits. It does not compare every page body, open every image, download every attachment or exercise each user’s permissions. Those would be useful additional acceptance checks. We do not automate an interactive login in this procedure, and we do not claim that matching counts alone proves complete application correctness.

## What remains unfinished

**Off-host backups are in preparation.** Replication and remote-restore scripts exist, but that is not proof of successful remote storage or host-loss recovery. Local encrypted archives cannot protect against losing the machine holding them. Successful remote transfer, an independently preserved key and a tested remote restore are necessary before we can make that stronger claim. Today’s evidence is narrower: a working isolated restore procedure and a tested demo recovery.
