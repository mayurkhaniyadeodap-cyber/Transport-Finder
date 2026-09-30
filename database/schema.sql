CREATE DATABASE IF NOT EXISTS transport_finder CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE transport_finder;

-- Serviceability per transporter + pincode (+ handling branch)
CREATE TABLE IF NOT EXISTS transport_pincode (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transport_name VARCHAR(100) NOT NULL,
    pincode VARCHAR(10) NOT NULL,
    branch_name VARCHAR(150) NOT NULL DEFAULT '',
    city VARCHAR(150),
    location VARCHAR(150),
    district VARCHAR(150),
    state VARCHAR(150),
    pincode_type VARCHAR(50),
    documents_required TEXT,
    surface_delivery BOOLEAN NULL DEFAULT NULL,
    air_delivery BOOLEAN NULL DEFAULT NULL,
    rail_delivery BOOLEAN NULL DEFAULT NULL,
    source_url TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_transport_pincode_branch (transport_name, pincode, branch_name),
    INDEX idx_pincode (pincode),
    INDEX idx_city_state (city, state),
    INDEX idx_transport_pincode (transport_name, pincode)
);

-- Branch / godown / contact information (independent of serviceability)
CREATE TABLE IF NOT EXISTS transport_branch (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    transport_name VARCHAR(100) NOT NULL,
    branch_name VARCHAR(150) NOT NULL DEFAULT '',
    branch_type VARCHAR(100),
    godown_name VARCHAR(150),
    contact_number VARCHAR(255),
    alternate_contact VARCHAR(255),
    address TEXT,
    city VARCHAR(150),
    district VARCHAR(150),
    state VARCHAR(150),
    pincode VARCHAR(10) NOT NULL DEFAULT '',
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),
    source_url TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_branch (transport_name, branch_name, pincode),
    INDEX idx_branch_pincode (pincode),
    INDEX idx_branch_city_state (city, state),
    INDEX idx_branch_transport (transport_name)
);
