-- Keep the local requester free of Payment Operator authority so requester
-- masking and export-denial acceptance tests exercise the product boundary.
BEGIN;
DELETE FROM payment_authorities WHERE id='a8000000-0000-4000-8000-000000000001';
COMMIT;
