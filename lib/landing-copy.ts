import { MEMBER_COPY, STORAGE_COPY, DRAFT_COPY } from "./quotas";
export const faqs = [
  [
    "Does it fit a 15-person team?",
    `Yes. ${MEMBER_COPY} ${STORAGE_COPY} Fair use applies to CPU and database resources. Contact info@productivity-boost.com for more resources.`,
  ],
  [
    "What is BookStack, and who is BookHost for?",
    "BookStack is free, open-source software for organising documentation into books, chapters and pages. BookHost hosts it for teams that want a shared knowledge base without managing the underlying server, including existing self-hosters, small IT departments and agencies. BookHost is an independent hosting service, not an official BookStack product.",
  ],
  [
    "Where is our data hosted?",
    "Our core hosting and backups use Hetzner infrastructure in Germany or Finland, within the EU. This does not mean every service processes data only in the EU: Stripe payments and optional Google sign-in can involve international processing. Document intake (beta) sends the text of each uploaded document to Chutes when your team requests a draft, under the processing terms described in our German privacy notice and data processing agreement; we do not promise EU-only AI inference.",
  ],
  [
    "What happens if we need a backup restored?",
    "We make daily backups. Backups older than seven days are removed at the next daily retention run; with scheduled runs, this can add up to 24 hours. Contact support to agree which available backup to restore and what that means for changes made since that backup. A daily backup is not continuous recovery, and we do not promise a fixed restore time. BookStack content exports are also available during your subscription; they are useful for portability but are not necessarily a complete backup of users, settings and every system component.",
  ],
  [
    "How do cancellation and deletion work?",
    "Cancel through the customer portal, the public cancellation form at /cancel, or email support at any time for the end of your current monthly billing period. You retain normal access until that date, so export any content you want to keep before then. We delete active instance data within 30 days after the contract ends; protected backup copies expire within a further seven days. Earlier deletion can be requested, and statutory retention for invoices does not mean we keep your entire wiki. Consumer cancellation and withdrawal rights remain available as described in the terms.",
  ],
  [
    "Can we use our own domain?",
    "Yes. Every workspace gets a bookhost.co address, and owners can add their own domain in the dashboard: enter it, add the shown DNS records, and we serve the workspace on both addresses. The bookhost.co address keeps working.",
  ],
  [
    "Can you migrate our existing BookStack instance?",
    "Contact us before switching anything off. We will assess your version, data size, attachments, authentication and custom changes, then agree the scope, any separate cost and the cutover approach before work starts. Migration is not advertised as an automatic one-click import or as included for every existing setup. Keep your current instance and backup until the migrated content and permissions have been checked. The full procedure, the two files we need and what we do not migrate are on our migration page: https://bookhost.co/migrate",
  ],
  [
    "How does document intake work?",
    `Document intake is available now in beta. Upload a PDF, DOCX, Markdown or TXT file to get a draft with a summary, tags and a reviewer checklist. Check and edit the suggestion; only a team owner or admin can approve publication to BookStack. ${DRAFT_COPY} Files can be up to 10 MB and 60,000 extracted characters; scanned PDFs need OCR first. AI output can contain mistakes.`,
  ],
  [
    "Who can see drafts, and what is still planned?",
    "Intake is a shared inbox for your BookHost dashboard team: all team members can see its drafts and available destinations. It does not mirror each person's BookStack permissions. Only workspace owners/admins can publish; members can upload and review. BookStack page permissions apply after publication. Email intake and permission-aware AI answers are planned and are not available today. There is no committed release date.",
  ],
  [
    "Do I need a card for the trial, and will I be charged automatically?",
    "No card is required for the 14-day trial. Your trial starts when you sign up; your workspace is usually ready within 5 minutes. Add a payment method through Manage billing if you want to continue at €39/month plus applicable VAT after the trial. Without a payment method, the subscription ends automatically without a charge. Export anything you want to keep before the trial ends.",
  ],
  [
    "What support is included?",
    "Email support covers the hosted service, access problems and requests to restore an available backup. Contact info@productivity-boost.com with your instance address and a description of the issue; do not send passwords or private keys. There is no advertised 24/7 response commitment or fixed response-time SLA. Migration, custom integrations and additional work are assessed and agreed separately.",
  ],
];
export const benefits = [
  [
    "01",
    "A familiar wiki, without the server chores",
    "Keep your team's knowledge in BookStack's books, chapters and pages while we handle hosting, maintenance and security updates. Your private instance gives a small IT team or agency a shared place for procedures, handovers and client documentation.",
  ],
  [
    "02",
    "Backups with a way back",
    "Your instance is backed up daily, with restore help through support. Backups older than seven days are removed at the next daily retention run; with scheduled runs, this can add up to 24 hours. Export your content from BookStack whenever you need it, subject to your team's permissions.",
  ],
  [
    "03",
    "Review before it becomes team knowledge",
    `Document intake is available now (beta). Upload a document, check its suggested summary, tags and reviewer checklist, then have a team owner or admin approve the page for BookStack. ${DRAFT_COPY}`,
  ],
];
export const steps = [
  [
    "0",
    "Sign up and choose your workspace address",
    "No card is needed. Your workspace is ready in about 5 minutes, and BookStack has its own login.",
  ],
  [
    "1",
    "Upload a document",
    "Start a workspace with a 14-day free trial, then upload a PDF, DOCX, Markdown or TXT file and choose a destination book. Document intake is available now in beta.",
  ],
  [
    "2",
    "Check the draft",
    "Review the proposed page, summary, tags and reviewer checklist alongside the source preview (first 2,000 characters). Keep your original document for the full comparison. Edit mistakes and resolve open questions before publishing. AI suggestions need human review.",
  ],
  [
    "3",
    "Approve and publish",
    `A team owner or admin approves the draft to create a page in BookStack. The destination book determines who can read it. ${DRAFT_COPY}`,
  ],
];
