import { Message } from '../dist/index.js';
import { getMailpitClient } from './mailpit-client.js';

async function sendHtmlEmail() {
    const client = getMailpitClient();

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>HTML Email</title>
        </head>
        <body>
            <h1>Hello from emailjs!</h1>
            <p>This is an <strong>HTML</strong> email sent from a script.</p>
            <p>It was sent on ${new Date().toLocaleString()}.</p>
        </body>
        </html>
    `;

    const message = new Message({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test HTML Email to Mailpit',
        attachment: [
            { data: htmlContent, alternative: true, contentType: 'text/html' }
        ],
    });

    try {
        console.log('Attempting to send HTML email...');
        await client.sendAsync(message);
        console.log('HTML email sent successfully to Mailpit!');
    } catch (error) {
        console.error('Failed to send HTML email:', error);
    } finally {
        client.smtp.close();
    }
}

sendHtmlEmail();
