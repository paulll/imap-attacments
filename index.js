const fs      = require('fs');
const base64  = require('base64-stream');
const Imap    = require('imap');
const app = require('commander');
const rfc2047 = require('rfc2047');
const humansize = require('filesize.js');

/**
 * Зависимости:
 * - node.js
 * - npm
 *
 * Установка:
 * $ npm i .
 *
 * Использование:
 * $ mkdir downloaded_files
 * $ cd downloaded_files
 * $ node .. -u user@mail.ru -p mYpassw0rd -h imap.mail.ru
 */

app
	.version('1.0.0')
	.option('-u, --user <user>', 'full email (user@mail.ru)')
	.option('-p, --password <password>', 'password')
	.option('-h, --host [host]', 'host (e.x: imap.gmail.com)')
	.option('-p, --port [port]', 'port [993]')
	.parse(process.argv);

const imap = new Imap({
	user: app.user,
	password: app.password,
	host: app.host || ('imap.' + app.user.split('@').pop()),
	port: app.port || 993,
	tls: true
	//,debug: function(msg){console.log('imap:', msg);}
});

function toUpper(thing) { return thing && thing.toUpperCase ? thing.toUpperCase() : thing;}

function findAttachmentParts(struct, attachments) {
	attachments = attachments ||  [];
	for (let i = 0, len = struct.length, r; i < len; ++i)
		if (Array.isArray(struct[i]))
			findAttachmentParts(struct[i], attachments);
		else
			if (struct[i].disposition && ['INLINE', 'ATTACHMENT'].indexOf(toUpper(struct[i].disposition.type)) > -1)
				attachments.push(struct[i]);
	return attachments;
}

function buildAttMessageFunction(attachment) {
	if (attachment.disposition && attachment.disposition.type === 'inline') return () => {};
	let filename = (attachment.params && attachment.params.name) ?
		attachment.params.name  :
		(attachment.disposition && attachment.disposition.params && attachment.disposition.params.filename) ?
			attachment.disposition.params.filename :
			(Math.random().toString(16).substr(0,8) + '.unknown');
	if (filename.endsWith('unknown')) console.log(attachment);

	const encoding = attachment.encoding;

	if (filename.startsWith('='))
		filename = rfc2047.decode(filename);

	return (msg, seqno) => {
		msg.on('body', (stream, info) => {
			console.log('[*] Скачиваем %s (%s)', filename, humansize(info.size));
			const writeStream = fs.createWriteStream(filename);
			if (toUpper(encoding) === 'BASE64')
				stream.pipe(new base64.Base64Decode()).pipe(writeStream);
			else
				stream.pipe(writeStream);

		});
		msg.on('error', () => console.log('[!] Ошибка получения %s', filename));
		msg.once('end', () => console.log('[+] Завершено %s', filename));
	};
}

imap.once('ready', () => {
	imap.openBox('INBOX', true, (err, box) => {
		if (err) throw err;
		const f = imap.seq.fetch('1:1000000', {
			bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'],
			struct: true
		});
		f.on('message', (msg, seqno) => {
			msg.once('attributes', attrs => {
				const attachments = findAttachmentParts(attrs.struct);
				for (let i = 0, len=attachments.length ; i < len; ++i) {
					const attachment = attachments[i];
					const f = imap.fetch(attrs.uid , {
						bodies: attachment.partID ? [attachment.partID] : [],
						struct: true
					});
					f.on('message', buildAttMessageFunction(attachment));
				}
			});
			msg.on('error', () => console.log('[!] Метаданные %d не получены', seqno));
		});
		f.on('error', err => console.log('[!] Ошибка получения метаданных', err));
		f.once('end', () => (console.log('[+] Все метаданные получены'), imap.end()));
	});
});

imap.on('error', err => console.log('[!] Ошибка IMAP', err));
imap.once('end', () =>  console.log('[+] Загрузка завершена'));
imap.connect();