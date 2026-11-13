# AI Apparel CRM to Monday
Project: qpavspvpdebtbbffdcmo. Cron: ai-apparel-monday-sync, every minute.

Exports business accounts with contacts, online customers and company associations, CRM clients, quotes with line items, production jobs, existing invoice workflows, tasks, and job accounting references to the six existing AI Apparel CRM boards.

This is a one-way CRM-to-Monday projection. Associates may use Monday for visibility and collaboration. Monday comments, board-only fields and unchanged records are untouched. CRM-controlled values can be refreshed when the CRM source changes. Monday edits do not update the CRM. Records removed from the CRM are not automatically deleted from Monday.

Invoice status and payment status come from the existing CRM workflow. Cash receipts, collected tax and actual costs are not guessed from quote amounts. Internal quote cost estimates are included in job accounting details. This does not replace the separate Shopify financial reconciliation. Proof filenames are included; private proof files remain accessible in the CRM and are not published as public URLs. Mailboxes and email bodies are outside these six boards.

The function authenticates using the existing AI_APPAREL_FINANCIAL_CRON_TOKEN in a header. Its SQL RPC is service-role only and the two tracking tables have RLS enabled with no public policies. MONDAY_API_TOKEN remains server-side. Do not expose either key in frontend code.

Sync uses source IDs and fingerprints, checks Monday source-ID columns before creating untracked records, records item IDs after confirmed writes, and uses a three-minute lease to prevent overlapping runs. Initial backfill is bounded to 200 changed rows per invocation and a 95-second processing budget. Failures are retained in ai_crm.monday_sync_state.last_error and retried.

Operational check:
```sql
select kind,count(*) records,count(*) filter(where last_error is not null) failures
from ai_crm.monday_sync_state group by kind;
select jobname,schedule,active from cron.job where jobname='ai-apparel-monday-sync';
```
