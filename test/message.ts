import { readFileSync, createReadStream } from 'fs';
import { join } from 'path';

import test from 'ava';
import { simpleParser, AddressObject, ParsedMail } from 'mailparser';
import { SMTPServer } from 'smtp-server';

import { SMTPClient, Message, MessageAttachment } from '../email';
import { MessageHeaders } from '../smtp/message';

// eslint-disable-next-line no-var
var __dirname: string;
// @ts-expect-error compat hack for node 10
if (__dirname == null) {
	__dirname = join(process.cwd(), 'test');
}

/**
 * \@types/mailparser@3.0.2 breaks our code
 * @see https://github.com/DefinitelyTyped/DefinitelyTyped/pull/50744
 */
type ParsedMailCompat = Omit<ParsedMail, 'to'> & { to?: AddressObject };

const port = 5555;
const parseMap = new Map<string, ParsedMailCompat>();

const client = new SMTPClient({
	port,
	user: 'pooh',
	password: 'honey',
	ssl: true,
});
const server = new SMTPServer({
	secure: true,
	onAuth(auth, _session, callback) {
		if (auth.username == 'pooh' && auth.password == 'honey') {
			callback(null, { user: 'pooh' });
		} else {
			return callback(new Error('invalid user / pass'));
		}
	},
	async onData(stream, _session, callback: () => void) {
		const mail = (await simpleParser(stream, {
			skipHtmlToText: true,
			skipTextToHtml: true,
			skipImageLinks: true,
		} as Record<string, unknown>)) as ParsedMailCompat;

		parseMap.set(mail.subject as string, mail);
		callback();
	},
});

function send(headers: Partial<MessageHeaders>) {
	return new Promise<ParsedMailCompat>((resolve, reject) => {
		client.send(new Message(headers), (err) => {
			if (err) {
				reject(err);
			} else {
				resolve(parseMap.get(headers.subject as string) as ParsedMailCompat);
			}
		});
	});
}

test.before(async (t) => {
	server.listen(port, t.pass);
});
test.after(async (t) => {
	server.close(t.pass);
});

test('simple text message', async (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		cc: 'gannon@gmail.com',
		bcc: 'gannon@gmail.com',
		text: 'hello friend, i hope this message finds you well.',
		'message-id': 'this is a special id',
	};

	const mail = await send(msg);
	t.is(mail.text, msg.text + '\n\n\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
	t.is(mail.messageId, '<' + msg['message-id'] + '>');
});

test('null text message', async (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		text: null,
		'message-id': 'this is a special id',
	};

	const mail = await send(msg);
	t.is(mail.text, '\n\n\n');
});

test('empty text message', async (t) => {
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'zelda@gmail.com',
		to: 'gannon@gmail.com',
		text: '',
		'message-id': 'this is a special id',
	};

	const mail = await send(msg);
	t.is(mail.text, '\n\n\n');
});

test('simple unicode text message', async (t) => {
	const msg = {
		subject: 'this ✓ is a test ✓ TEXT message from emailjs',
		from: 'zelda✓ <zelda@gmail.com>',
		to: 'gannon✓ <gannon@gmail.com>',
		text: 'hello ✓ friend, i hope this message finds you well.',
	};

	const mail = await send(msg);
	t.is(mail.text, msg.text + '\n\n\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('very large text message', async (t) => {
	// thanks to jart+loberstech for this one!
	const msg = {
		subject: 'this is a test TEXT message from emailjs',
		from: 'ninjas@gmail.com',
		to: 'pirates@gmail.com',
		text: readFileSync(join(__dirname, 'attachments/smtp.txt'), 'utf-8'),
	};

	const mail = await send(msg);
	t.is(mail.text, msg.text.replace(/\r/g, '') + '\n\n\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('very large text data message', async (t) => {
	const text =
		'<html><body><pre>' +
		readFileSync(join(__dirname, 'attachments/smtp.txt'), 'utf-8') +
		'</pre></body></html>';

	const msg = {
		subject: 'this is a test TEXT+DATA message from emailjs',
		from: 'lobsters@gmail.com',
		to: 'lizards@gmail.com',
		text: 'hello friend if you are seeing this, you can not view html emails. it is attached inline.',
		attachment: {
			data: text,
			alternative: true,
		},
	};

	const mail = await send(msg);
	t.is(mail.html, text.replace(/\r/g, ''));
	t.is(mail.text, msg.text + '\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('html data message', async (t) => {
	const html = readFileSync(join(__dirname, 'attachments/smtp.html'), 'utf-8');
	const msg = {
		subject: 'this is a test TEXT+HTML+DATA message from emailjs',
		from: 'obama@gmail.com',
		to: 'mitt@gmail.com',
		attachment: {
			data: html,
			alternative: true,
		},
	};

	const mail = await send(msg);
	t.is(mail.html, html.replace(/\r/g, ''));
	t.is(mail.text, '\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('html file message', async (t) => {
	const html = readFileSync(join(__dirname, 'attachments/smtp.html'), 'utf-8');
	const msg = {
		subject: 'this is a test TEXT+HTML+FILE message from emailjs',
		from: 'thomas@gmail.com',
		to: 'nikolas@gmail.com',
		attachment: {
			path: join(__dirname, 'attachments/smtp.html'),
			alternative: true,
		},
	};

	const mail = await send(msg);
	t.is(mail.html, html.replace(/\r/g, ''));
	t.is(mail.text, '\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('html with image embed message', async (t) => {
	const html = readFileSync(join(__dirname, 'attachments/smtp2.html'), 'utf-8');
	const image = readFileSync(join(__dirname, 'attachments/smtp.gif'));
	const msg = {
		subject: 'this is a test TEXT+HTML+IMAGE message from emailjs',
		from: 'ninja@gmail.com',
		to: 'pirate@gmail.com',
		attachment: {
			path: join(__dirname, 'attachments/smtp2.html'),
			alternative: true,
			related: [
				{
					path: join(__dirname, 'attachments/smtp.gif'),
					type: 'image/gif',
					name: 'smtp-diagram.gif',
					headers: { 'Content-ID': '<smtp-diagram@local>' },
				},
			],
		},
	};

	const mail = await send(msg);
	t.is(
		mail.attachments[0].content.toString('base64'),
		image.toString('base64')
	);
	t.is(mail.html, html.replace(/\r/g, ''));
	t.is(mail.text, '\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('html data and attachment message', async (t) => {
	const html = readFileSync(join(__dirname, 'attachments/smtp.html'), 'utf-8');
	const msg = {
		subject: 'this is a test TEXT+HTML+FILE message from emailjs',
		from: 'thomas@gmail.com',
		to: 'nikolas@gmail.com',
		attachment: [
			{ path: join(__dirname, 'attachments/smtp.html'), alternative: true },
			{ path: join(__dirname, 'attachments/smtp.gif') },
		] as MessageAttachment[],
	};

	const mail = await send(msg);
	t.is(mail.html, html.replace(/\r/g, ''));
	t.is(mail.text, '\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('attachment message', async (t) => {
	const pdf = readFileSync(join(__dirname, 'attachments/smtp.pdf'));
	const msg = {
		subject: 'this is a test TEXT+ATTACHMENT message from emailjs',
		from: 'washing@gmail.com',
		to: 'lincoln@gmail.com',
		text: 'hello friend, i hope this message and pdf finds you well.',
		attachment: {
			path: join(__dirname, 'attachments/smtp.pdf'),
			type: 'application/pdf',
			name: 'smtp-info.pdf',
		} as MessageAttachment,
	};

	const mail = await send(msg);
	t.is(mail.attachments[0].content.toString('base64'), pdf.toString('base64'));
	t.is(mail.text, msg.text + '\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('attachment sent with unicode filename message', async (t) => {
	const pdf = readFileSync(join(__dirname, 'attachments/smtp.pdf'));
	const msg = {
		subject: 'this is a test TEXT+ATTACHMENT message from emailjs',
		from: 'washing@gmail.com',
		to: 'lincoln@gmail.com',
		text: 'hello friend, i hope this message and pdf finds you well.',
		attachment: {
			path: join(__dirname, 'attachments/smtp.pdf'),
			type: 'application/pdf',
			name: 'smtp-✓-info.pdf',
		} as MessageAttachment,
	};

	const mail = await send(msg);
	t.is(mail.attachments[0].content.toString('base64'), pdf.toString('base64'));
	t.is(mail.attachments[0].filename, 'smtp-✓-info.pdf');
	t.is(mail.text, msg.text + '\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('attachments message', async (t) => {
	const pdf = readFileSync(join(__dirname, 'attachments/smtp.pdf'));
	const tar = readFileSync(join(__dirname, 'attachments/postfix-2.8.7.tar.gz'));
	const msg = {
		subject: 'this is a test TEXT+2+ATTACHMENTS message from emailjs',
		from: 'sergey@gmail.com',
		to: 'jobs@gmail.com',
		text: 'hello friend, i hope this message and attachments finds you well.',
		attachment: [
			{
				path: join(__dirname, 'attachments/smtp.pdf'),
				type: 'application/pdf',
				name: 'smtp-info.pdf',
			},
			{
				path: join(__dirname, 'attachments/postfix-2.8.7.tar.gz'),
				type: 'application/tar-gz',
				name: 'postfix.source.2.8.7.tar.gz',
			},
		] as MessageAttachment[],
	};

	const mail = await send(msg);
	t.is(mail.attachments[0].content.toString('base64'), pdf.toString('base64'));
	t.is(mail.attachments[1].content.toString('base64'), tar.toString('base64'));
	t.is(mail.text, msg.text + '\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('streams message', async (t) => {
	const pdf = readFileSync(join(__dirname, 'attachments/smtp.pdf'));
	const tar = readFileSync(join(__dirname, 'attachments/postfix-2.8.7.tar.gz'));
	const stream = createReadStream(join(__dirname, 'attachments/smtp.pdf'));
	const stream2 = createReadStream(
		join(__dirname, 'attachments/postfix-2.8.7.tar.gz')
	);

	const msg = {
		subject: 'this is a test TEXT+2+STREAMED+ATTACHMENTS message from emailjs',
		from: 'stanford@gmail.com',
		to: 'mit@gmail.com',
		text: 'hello friend, i hope this message and streamed attachments finds you well.',
		attachment: [
			{ stream, type: 'application/pdf', name: 'smtp-info.pdf' },
			{
				stream: stream2,
				type: 'application/x-gzip',
				name: 'postfix.source.2.8.7.tar.gz',
			},
		],
	};

	stream.pause();
	stream2.pause();

	const mail = await send(msg);
	t.is(mail.attachments[0].content.toString('base64'), pdf.toString('base64'));
	t.is(mail.attachments[1].content.toString('base64'), tar.toString('base64'));
	t.is(mail.text, msg.text + '\n');
	t.is(mail.subject, msg.subject);
	t.is(mail.from?.text, msg.from);
	t.is(mail.to?.text, msg.to);
});

test('message validation fails without `from` header', async (t) => {
	const msg = new Message({});
	const { isValid, validationError } = msg.checkValidity();
	t.false(isValid);
	t.is(validationError, 'Message must have a `from` header');
});

test('message validation fails without `to`, `cc`, or `bcc` header', async (t) => {
	const { isValid, validationError } = new Message({
		from: 'piglet@gmail.com',
	}).checkValidity();

	t.false(isValid);
	t.is(
		validationError,
		'Message must have at least one `to`, `cc`, or `bcc` header'
	);
});

test('message validation succeeds with only `to` recipient header (string)', async (t) => {
	const { isValid, validationError } = new Message({
		from: 'piglet@gmail.com',
		to: 'pooh@gmail.com',
	}).checkValidity();

	t.true(isValid);
	t.is(validationError, undefined);
});

test('message validation succeeds with only `to` recipient header (array)', async (t) => {
	const { isValid, validationError } = new Message({
		from: 'piglet@gmail.com',
		to: ['pooh@gmail.com'],
	}).checkValidity();

	t.true(isValid);
	t.is(validationError, undefined);
});

test('message validation succeeds with only `cc` recipient header (string)', async (t) => {
	const { isValid, validationError } = new Message({
		from: 'piglet@gmail.com',
		cc: 'pooh@gmail.com',
	}).checkValidity();

	t.true(isValid);
	t.is(validationError, undefined);
});

test('message validation succeeds with only `cc` recipient header (array)', async (t) => {
	const { isValid, validationError } = new Message({
		from: 'piglet@gmail.com',
		cc: ['pooh@gmail.com'],
	}).checkValidity();

	t.true(isValid);
	t.is(validationError, undefined);
});

test('message validation succeeds with only `bcc` recipient header (string)', async (t) => {
	const { isValid, validationError } = new Message({
		from: 'piglet@gmail.com',
		bcc: 'pooh@gmail.com',
	}).checkValidity();

	t.true(isValid);
	t.is(validationError, undefined);
});

test('message validation succeeds with only `bcc` recipient header (array)', async (t) => {
	const { isValid, validationError } = new Message({
		from: 'piglet@gmail.com',
		bcc: ['pooh@gmail.com'],
	}).checkValidity();

	t.true(isValid);
	t.is(validationError, undefined);
});
