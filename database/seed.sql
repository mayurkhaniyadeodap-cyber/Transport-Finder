-- Sample rows for local development only (TCI example from the spec).
-- Godown/contact/address are intentionally NOT seeded: they are unknown.
USE transport_finder;

INSERT INTO transport_pincode
    (transport_name, pincode, branch_name, city, location, state, pincode_type,
     documents_required, surface_delivery, air_delivery, rail_delivery, source_url)
VALUES
    ('TCI Express', '110001', 'XPHJ-PAHARGANJ', 'New Delhi', 'New Delhi', 'Delhi', 'SERVICEABLE',
     'Copies of Invoice, E-Way Bill', TRUE, TRUE, TRUE,
     'https://www.tciexpress.in/pincode-enquiry.aspx')
ON DUPLICATE KEY UPDATE last_updated = CURRENT_TIMESTAMP;
