# AI Apparel catalog draft

Shopify draft theme: 190400135355, page /pages/catalog. Storefront source is in ../storefront.

The tested backend version b2668300-2fa3-4429-b212-caa279441981 is deployed at https://ai-apparel-sanmar-api.bikard.workers.dev (deployment 593ef60a-4b3c-493f-9749-2670fed82145). The Shopify draft now uses this production endpoint. Existing CRM route authentication and secret bindings are retained. Previous version for rollback: 6d5dda1e-64f9-4c37-9eb6-65eb86dc1acb. Version alias catalog-stage remains available for testing. It serves public product-only /public/catalog, /public/product and /public/promo GET endpoints. Every output is explicitly allowlisted; pricing, supplier costs, diagnostics and credentials are excluded. CORS allows only the AI Apparel storefront domains. Product and search results are cached.

SanMar uses live GetProduct calls for a featured selection in 11 categories and arbitrary exact style lookup. Broad category web-service calls generate FTP exports instead of returning product data. Full assortment indexing requires that export pipeline; it is not represented as implemented. SAGE supports keyword searches, with up to 1,000 returned matches and client pagination. Promotional prices are hidden too.

The quote list stores product selections only in browser localStorage, up to ten selections. Selection summaries prefill the public Monday WorkForm via catalog_items. Monday validates customer inputs and applies reCAPTCHA before writing to the private Website Inquiries board 18440006863. Form question long_textot8p9vp2 stores the selections. No customer contact information is stored locally.

Verification: syntax checks passed; staged live product/category/search calls passed for polos, tees, outerwear, caps, arbitrary LOG105, SAGE tumbler keyword and product details. Inspected responses recursively for disallowed price/credential fields. Browser verified K500 Royal/L/24 quote selection and WorkForm prefill, and supplier names removed from customer-facing text. Initial contact-form response routing was verified separately. No catalog test inquiry was submitted.

Source names remain internal identifiers only; customer UI labels are Apparel and Promotional Products.

Production readiness verification: live health, K500 details, T-Shirts category and promotional keyword search passed. Protected CRM product/price POSTs reject unauthenticated requests with 401. Public output recursive checks found no pricing/cost/credential fields. Browser rechecked the draft on the production endpoint: K500 Royal/L/24 passed into the Monday form. No new test form was submitted through reCAPTCHA; original inquiry routing was tested previously. Theme remains unpublished. Initial launch supports featured apparel plus exact style lookup, not a full assortment index.
