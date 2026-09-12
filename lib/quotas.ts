// Public plan limits. Storage GB is decimal; the worker measures upload bytes.
export const QUOTAS = {
  members: 25,
  trialDrafts: 20,
  monthlyDrafts: 300,
  trialChatQuestions: 100,
  monthlyChatQuestions: 1000,
  storageGB: 5,
  storageWarningRatio: 0.8,
} as const;
export const MEMBER_COPY = `Up to ${QUOTAS.members} BookHost dashboard members per workspace, including the owner. Native or imported BookStack accounts are not counted by this limit.`;
export const DRAFT_COPY = `${QUOTAS.trialDrafts} drafts during the trial; ${QUOTAS.monthlyDrafts} drafts per calendar month (UTC) on Team, shared by the workspace. Processing reserves a place; failed draft generation returns it to its original period. Unused places do not roll over. Rejected drafts and failed publication still count.`;
export const CHAT_COPY = `${QUOTAS.trialChatQuestions} wiki questions during the trial; ${QUOTAS.monthlyChatQuestions} per calendar month (UTC) on Team, shared by the workspace. Answers are limited to content the workspace API already sees and always name the source pages.`;
export const STORAGE_COPY = `${QUOTAS.storageGB} GB of uploads included (1 GB = 1 billion bytes). Upload directories are measured periodically; the dashboard warns from ${QUOTAS.storageWarningRatio * 100}% by default. Uploads are not automatically blocked at this allowance. Contact support for higher storage needs; no automatic storage emails.`;
