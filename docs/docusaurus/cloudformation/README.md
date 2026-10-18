# Documentation site hosting

`config.yml` is the CloudFormation stack for the bucket that serves
[openbtps.org](https://www.openbtps.org): an S3 static website, readable by
anyone, with Cloudflare in front of it. It holds no secrets; the bucket name
is a parameter.

## Updating the site

The site is not deployed by CI. To publish the current docs:

```sh
cd docs/docusaurus
npm ci && npm run build                          # fails on any broken link
aws s3 sync build/ s3://<bucket> --delete       # with an AWS profile allowed to write to the bucket
```

Then purge Cloudflare's cache for the site, so visitors get the new pages.

Publish from `master`, after a release is merged, so the site matches the
released SDK.
