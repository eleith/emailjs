// scripts/mailpit-client.js
// Common client setup for connecting to Mailpit

import { SMTPClient } from '../dist/index.js';

export function getMailpitClient(overrides = {}) {
    const defaultOptions = {
        host: 'localhost',
        port: 1025, // Mailpit SMTP Port
        user: 'user',
        password: 'password123',
        // Mailpit uses a self-signed cert, so rejectUnauthorized: false is needed for TLS/STARTTLS
        tls: {
            rejectUnauthorized: false,
        },
    };

    const clientOptions = { ...defaultOptions, ...overrides };

    return new SMTPClient(clientOptions);
}