# emailjs 📧✨

Send emails with ease!

This library lets you send rich HTML emails,
attachments (from files, streams, or strings), and plain text messages to any
SMTP server.

[![checks](https://github.com/eleith/emailjs/actions/workflows/check.yml/badge.svg)](https://github.com/eleith/emailjs/actions/workflows/check.yml)

## What's to expect from emailjs? 🚀

- **SSL and TLS Support:** Secure connections to your SMTP servers.
- **Authentication Galore:** Supports popular SMTP authentication methods like
  `PLAIN`, `LOGIN`, `CRAM-MD5`, and `XOAUTH2`.
- **Asynchronous Sending:** Emails are queued and sent in the
  background.
- **Rich Content:** Send HTML emails and include multiple attachments.
- **Flexible Attachments:** Attachments can be files, data streams, or plain
  strings.
- **UTF-8 Ready:** Full support for UTF-8 in headers and body.
- **Built-in Type Declarations:** first-class TypeScript support.
- **Greylisting Awareness:** Automatically handles
  [greylisting](http://projects.puremagic.com/greylisting/whitepaper.html) to
  improve deliverability.

## Get Started! 🛠️

### Installing

It's super simple!

```bash
npm install emailjs
```

### Requirements

- Access to an SMTP Server.
- If your email service (like Gmail) uses two-step verification, you'll need an
  application-specific password.

### Quick Examples 🧑‍💻

Here's how easy it is to send emails:

#### Text-Only Emails

```javascript
import { SMTPClient } from 'emailjs'

const client = new SMTPClient({
	user: 'your-username',
	password: 'your-password',
	host: 'smtp.your-email.com',
	ssl: true, // Use SSL for secure connection
})

async function sendMyEmail() {
	try {
		const message = await client.sendAsync({
			text: 'Hello from emailjs! This is a test message.',
			from: 'You <your-email@example.com>',
			to: 'Someone <someone@example.com>',
			subject: 'Exciting News from emailjs! 🎉',
		})
		console.log('Email sent successfully:', message)
	} catch (err) {
		console.error('Failed to send email:', err)
	} finally {
		client.smtp.close() // Don't forget to close the connection!
	}
}

sendMyEmail()
```

#### HTML Emails & Attachments

```javascript
import { SMTPClient, Message } from 'emailjs'

const client = new SMTPClient({
	user: 'your-username',
	password: 'your-password',
	host: 'smtp.your-email.com',
	tls: true,
})

async function sendRichEmail() {
	const htmlContent = `
        <h1>Greetings!</h1>
        <p>This is an <b>HTML email</b> with a lovely picture and an attachment.</p>
        <img src="cid:my-image" alt="Embedded Image" width="150" height="100">
        <p>Check out the attached file!</p>
    `

	const message = new Message({
		from: 'You <your-email@example.com>',
		to: 'Someone <someone@example.com>',
		subject: 'Your Awesome HTML Email! 🖼️📄',
		attachment: [
			{
				data: htmlContent,
				alternative: true, // This part is the HTML body
				contentType: 'text/html',
			},
			{
				path: 'path/to/your/document.pdf', // Attach a file from disk
				type: 'application/pdf',
				name: 'document.pdf',
			},
			{
				path: 'path/to/your/image.jpg', // Embed an image for the HTML
				type: 'image/jpeg',
				name: 'cool_image.jpg',
				// Reference in HTML with cid:my-image
				headers: { 'Content-ID': '<my-image>' },
			},
		],
	})

	try {
		await client.sendAsync(message)
		console.log('Rich email sent successfully!')
	} catch (err) {
		console.error('Failed to send rich email:', err)
	} finally {
		client.smtp.close()
	}
}

sendRichEmail()
```

## API Reference 📖

The `emailjs` library is fully typed, here is a brief overview of most likely to
be used methods

### `new SMTPClient(options)`

Create a new client instance to connect to your SMTP server.

```javascript
const options = {
	user: 'your-username', // 🔑 Username for logging into SMTP
	password: 'your-password', // 🤫 Password for logging into SMTP
	host: 'smtp.your-email.com', // 🌐 SMTP server host (defaults to 'localhost')
	port: 587, // 🔌 SMTP port (defaults: 25 unencrypted, 465 SSL, 587 TLS)
	ssl: true, // 🔒 Boolean or object for immediate SSL connection
	tls: true, // 🔐 Boolean or object (see typescript types) to initiate STARTTLS
	timeout: 5000, // ⏳ Max milliseconds to wait for SMTP responses
	domain: 'your-domain.com', // 🏠 Domain to greet SMTP with (defaults to os.hostname)
	authentication: ['PLAIN', 'LOGIN'], // 🤝 Preferred authentication methods
	logger: console, // 📝 Override the built-in logger (e.g., custom logging)
}
```

### `SMTPClient#send(message, callback)`

Sends an email message. You can pass a `Message` instance or a headers object.

```javascript
client.send(messageObject, (err, details) => {
	if (err) console.error(err)
	else console.log('Message sent:', details)
})
```

### `SMTPClient#sendAsync(message)`

a promise-based way to send emails! ✨

```javascript
try {
	const details = await client.sendAsync(messageObject)
	console.log('Message sent:', details)
} catch (err) {
	console.error('Failed to send:', err)
}
```

### `new Message(headers)`

Constructs an RFC2822-compliant message object.

```javascript
const headers = {
	from: 'sender@example.com', // 💌 Sender (required!)
	to: 'recipient@example.com', // 📬 Recipients (at least one of to, cc, or bcc)
	cc: 'carbon-copy@example.com', // 👥 CC recipients
	bcc: 'blind-copy@example.com', // 🕵️‍♀️ BCC recipients
	subject: 'Your Subject Here', // 📝 Email subject
	text: 'Plain text body.', // 🗒️ Plain text content
	attachment: [{ data: 'Hello!' }], // 📎 One or more attachments
}
```

### `Message#attach(options)`

Adds an attachment to the message. Can be called multiple times.

```javascript
message.attach({
	path: 'path/to/file.zip', // 📁 Path to a file on disk
	data: 'Binary content as string or buffer', // 📄 Raw data
	stream: fs.createReadStream('file.jpg'), // 🌊 A readable stream
	type: 'application/zip', // MIME type
	name: 'custom-name.zip', // Filename perceived by recipient
	alternative: true, // attach inline as an alternative (e.g., HTML body)
	inline: true, // If true, attached inline (e.g., for <img src="cid:...">)
	headers: { 'X-Custom-Header': 'value' }, // Custom attachment headers
})
```

### `Message#checkValidity()`

Synchronously validates that a `Message` is properly formed before sending.

```javascript
const { isValid, validationError } = message.checkValidity()
if (!isValid) {
	console.error('Message is invalid:', validationError)
}
```

## Authors ✍️

- eleith
- zackschuster

## Testing 🧪

```bash
# Run all tests
npm test

# Run tests with code coverage report
npm run test:coverage
```

## Development 🧑‍💻🌱

for a local smtp testing experience, use our
[Mailpit](https://mailpit.axllent.org/) compose service

### 1. Start Mailpit with Docker Compose

Ensure you have Docker and Docker Compose installed.

```bash
# From the project root, start Mailpit
docker compose up
```

Mailpit will be accessible via:

- **Web UI:** `http://localhost:8025`
- **SMTP Server:** `localhost:1025`

### 2. Run Example Sending Scripts

You can use the provided scripts to send different types of emails to your local
Mailpit instance.

First, make sure the `emailjs` library is built:

```bash
npm run build
```

Then, run any of the example scripts:

```bash
# Send a plain text email
node scripts/send-text.js

# Send an HTML email
node scripts/send-html.js

# Send an email with attachments
node scripts/send-attachment.js
```

After running a script, open your Mailpit Web UI (`http://localhost:8025`) to
see the emails stream in! 📩
