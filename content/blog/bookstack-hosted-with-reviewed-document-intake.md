---
title: "BookStack, hosted — with reviewed document intake"
description: "Hosted BookStack with document intake now available in beta: what BookHost runs, how review works, current limits and the backup work still ahead."
date: "2026-09-09"
author: "Florian Standhartinger"
tags: ["BookStack", "Document intake", "Hosting"]
---

BookStack gives a team a straightforward place to keep knowledge: books, chapters and pages, with an editor that does not require everyone to learn a new publishing system. BookHost is our new service for teams that want that experience without taking on another server. Hosted BookStack and **reviewed document intake (beta) are available now**. Upload a document, review the proposed page and approve it for publication. Email intake is still planned. [BookStack](https://www.bookstackapp.com/), [BookHost](https://bookhost.co).

## Why start with BookStack?

A wiki should make an ordinary task easy: finding the current instructions and correcting them when they are wrong. BookStack's books, chapters and pages give that work a visible structure. It includes search, page revisions, permissions, and both WYSIWYG and Markdown editing. It is free software under the MIT licence, so paying a hosting provider is a choice about operations, rather than a requirement to unlock the underlying wiki. [BookStack features](https://www.bookstackapp.com/).

There is an established community behind it. On 8 September 2026, the GitHub repository displayed approximately **19,000 stars**, and Docker Hub displayed **50M+ pulls** for the LinuxServer BookStack image. Those are useful signs of adoption, but neither measures active teams or satisfied customers: pulls include repeated downloads, and stars are expressions of interest. The GitHub repository now points development to Codeberg. These are rounded public counters, not a market-size forecast. [GitHub repository](https://github.com/BookStackApp/BookStack), [Docker Hub image](https://hub.docker.com/r/linuxserver/bookstack).

## Why teams still self-host

Self-hosting is a reasonable choice when a team already has someone responsible for servers and wants control over its deployment. That person can choose the database, storage and update schedule. BookStack's documented installation requirements include PHP and a MySQL-compatible database; the project also points to community container options. If your organisation already runs that stack well, another hosting subscription may add little value. [Installation documentation](https://www.bookstackapp.com/docs/admin/installation/).

The question I would ask is who owns the wiki when its original administrator is away. A small team can answer that with a runbook and a second person who has actually used it. A managed service offers a different allocation of that responsibility. Neither arrangement removes the need for someone in the team to own the content, decide who may read it, and notice when an instruction has become wrong.

## The backup job is only the beginning

BookStack's backup documentation covers both the database and files, including uploaded images, attachments and the configuration file. A database dump by itself can leave you with page text that refers to missing files. Restoring the database is also part of the startup order for a fresh container-based restoration. The recovery instructions are worth reading before you need them. [Backup and restore](https://www.bookstackapp.com/docs/admin/backup-restore/).

Our suggested acceptance check is deliberately concrete. Restore into a separate environment, open a known book, compare a page, download an attachment and inspect an image. Check permissions with an ordinary account as well as an administrator. Record which backup was used and what was checked. These are our proposed operating checks, not a claim that every one is already covered by BookHost's current restore test. A green process exit alone is too little evidence for a recovery promise.

Updates deserve similar attention. BookStack publishes version-specific update notes, including changes that need operator action. Updating an application and changing a database major version should be treated as separate decisions with a recovery path. A running container does not establish that an old database will behave correctly under an arbitrary newer image. Read the notes for the actual versions you are moving between. [BookStack update instructions](https://www.bookstackapp.com/docs/admin/updates/).

## What BookHost operates today

BookHost provisions a BookStack application and MariaDB for each team, with a team-specific address. The control plane handles the subscription and provisioning request; a worker manages the tenant lifecycle. This is our operating layer around BookStack, rather than a claim that we created the wiki. The implementation is available in our public repository, including tenant provisioning and restore checks. [BookHost source](https://github.com/fstandhartinger/bookstack-ops), [provisioner](https://github.com/fstandhartinger/bookstack-ops/tree/main/ops/provisioner).

Daily backups encrypt the archive and authenticate it before restoration. We have tested a demo restore into temporary containers, comparing book and page counts and selected titles. That is a real recovery check, not an independent audit, a recovery-time SLA or proof of complete host-loss recovery. **Off-host backup delivery is in preparation**; we do not describe local encrypted backups as protection against losing the whole host. Our [backup restore article](/blog/how-we-test-every-bookstack-backup-restore) explains what the test covers and what it does not. [Operations documentation](https://github.com/fstandhartinger/bookstack-ops/tree/main/ops/provisioner).

You can sign in to BookHost with an email address and password. You can also explore the [public, read-only demo](https://demo.wissen.app.mintapis.com) without creating an account. It contains example team knowledge so you can assess BookStack's structure before starting a workspace. Demo content illustrates the workflow; it is not evidence that a particular document has passed through intake.

## What reviewed intake means today

The available beta starts with an uploaded PDF, DOCX, Markdown or text file. A model proposes a draft with a summary, tags and a reviewer checklist. A person checks the source, edits the proposal and chooses where it belongs. Only a team owner or admin can approve publication to BookStack. Email intake remains planned. This is BookHost's workflow around BookStack, not a feature claimed for the upstream project. [Current intake details](https://bookhost.co/#faq).

For example, a supplier might send a revised maintenance procedure. The reviewer should check which equipment it applies to, whether a warning disappeared, and whether the proposed destination is visible to the right colleagues. A plausible summary does not settle those questions. AI output can contain mistakes, so approval is a responsibility, not a ceremonial click. Permission-aware answers and reminders about ageing content remain later work.

The trial includes **20 drafts in total** and Team includes **300 drafts per month**. Uploads can be up to **10 MB**, with a limit of **60,000 extracted characters**; scanned PDFs need OCR first. Document text is sent to Chutes to generate a draft. We do not promise EU-only AI inference; read the [privacy notice](/legal/datenschutz) and [processing agreement](/legal/avv) before uploading sensitive material. [BookHost limits and processing details](https://bookhost.co/#faq).

## Price and a fair comparison

BookHost's Team plan is **€39 per month plus applicable VAT**, with a **14-day trial without a card**, and monthly cancellation. Team includes **up to 25 users per workspace and 5 GB of uploads**. [BookHost plan limits](https://bookhost.co/#faq). Stellar Hosted advertises BookStack Standard at **€49 per month**, including 10 GB of storage, a custom domain and email support; its prices exclude VAT. Its Custom plan starts at **€149 per month**. The competitor prices were recorded on 8 September 2026; BookHost's plan details reflect 9 September 2026. The offerings have different inclusions, so the price difference alone does not establish which provider fits a team. [BookHost pricing](https://bookhost.co), [Stellar BookStack plans](https://www.stellarhosted.com/bookstack/).

If you already operate BookStack confidently, keep the arrangement that works. If you want to assess a managed option, [open BookHost and its demo](https://bookhost.co/?utm_source=blog&utm_medium=owned&utm_campaign=pilot40). Try the public demo, then use the trial to complete an intake review yourself. Judge the beta on whether its draft saves useful work after your checks. Bring a representative, non-sensitive example and check whether the wiki fits how your team actually works.
