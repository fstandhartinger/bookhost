Wissen's hosting operations include encrypted daily backups of the BookStack database and application files. A useful backup must be restorable; an archive existing on disk is not sufficient evidence.

## What is checked
The operator's restore test starts an isolated copy, restores the database and files, boots BookStack and compares page counts, book counts and book titles with the snapshot. The temporary copy has no public route and is removed after the test.

## What a restore means for your team
Restoring a snapshot returns the workspace to that snapshot's state. Changes made afterward may need to be recovered separately. Before requesting a restore, identify the affected workspace, the approximate time of the problem and the content you need. Avoid making unrelated edits while the recovery approach is being agreed.

## What these checks do not promise
A count comparison does not prove that every attachment renders correctly or that a particular recovery deadline can be met. Ask the operator about the latest successful backup, retention, offsite coverage and the expected recovery window for your workspace. This demo is not a service-level agreement.

## Keep a portable copy
Authorized readers can use BookStack's export options for content they can access. An exported page is useful for portability, but it does not replace a complete application backup or preserve every permission and account setting.

**Owner:** Workspace administrator and hosting operator. Review recovery expectations before storing business-critical knowledge.
