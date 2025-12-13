import { Message } from '../dist/index.js';
import { getMailpitClient } from './mailpit-client.js';

async function sendAttachmentEmail() {
    const client = getMailpitClient();

    const attachmentContent = `This is the content of the attached file.
It can be anything you want to attach.
Timestamp: ${new Date().toISOString()}`;

    const message = new Message({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Email with Attachment to Mailpit',
        text: 'Please find the attachment.',
        attachment: [
            {
                data: attachmentContent,
                type: 'text/plain',
                name: 'attachment.txt',
            },
            {
                path: 'test/attachments/smtp.pdf', // Using an existing fixture for a real file attachment
                type: 'application/pdf',
                name: 'document.pdf',
            }
        ],
    });

    try {
        console.log('Attempting to send email with attachment...');
        await client.sendAsync(message);
        console.log('Email with attachment sent successfully to Mailpit!');
    } catch (error) {
        console.error('Failed to send email with attachment:', error);
    } finally {
        client.smtp.close();
    }
}

sendAttachmentEmail();
