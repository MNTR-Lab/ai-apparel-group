# AI Apparel catalog draft

Shopify draft theme: 190400135355, page /pages/catalog. Storefront source is in ../storefront.

The backend source is an additive staged version of the existing SanMar API Worker. Production CRM routes and bindings have not been changed. Version alias: catalog-stage. It serves public product-only /public/catalog, /public/product and /public/promo GET endpoints. Every output is explicitly allowlisted; pricing, supplier costs, diagnostics and credentials are excluded. CORS allows only the AI Apparel storefront domains. Product and search results are cached.

SanMar uses live GetProduct calls for a featured selection in 11 categories and arbitrary exact style lookup. Broad category web-service calls generate FTP exports instead of returning product data. Full assortment indexing requires that export pipeline; it is not represented as implemented. SAGE supports keyword searches, with up to 1,000 returned matches and client pagination. Promotional prices are hidden too.

The quote list stores product selections only in browser localStorage, up to ten selections. Selection summaries prefill the public Monday WorkForm via catalog_items. Monday validates customer inputs and applies reCAPTCHA before writing to the private Website Inquiries board 18440006863. Form question long_textot8p9vp2 stores the selections. No customer contact information is stored locally.

Verification: syntax checks passed; staged live product/category/search calls passed for polos, tees, outerwear, caps, arbitrary LOG105, SAGE tumbler keyword and product details. Inspected responses recursively for disallowed price/credential fields. Browser verified K500 Royal/L/24 quote selection and WorkForm prefill, and supplier names removed from customer-facing text. Initial contact-form response routing was verified separately. No catalog test inquiry was submitted.

Source names remain internal identifiers only; customer UI labels are Apparel and Promotional Products.
