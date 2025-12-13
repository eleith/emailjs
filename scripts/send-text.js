import { Message } from '../dist/index.js';
import { getMailpitClient } from './mailpit-client.js';

async function sendTextEmail() {
    const client = getMailpitClient();

    const message = new Message({
        from: 'sender@example.com',
        to: 'recipient@example.com',
        subject: 'Test Text Email to Mailpit',
        text: 'This is a test text email sent from the emailjs library script to Mailpit.',
    });

    try {
        console.log('Attempting to send text email...');
        await client.sendAsync(message);
        console.log('Text email sent successfully to Mailpit!');
    } catch (error) {
        console.error('Failed to send text email:', error);
    } finally {
        client.smtp.close();
    }
}

sendTextEmail();