const fs = require('fs');
const base64 = require('base64-stream');
const Imap = require('imap');
const moment = require('moment');
const mkdirp = require('mkdirp');
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
 * $ node . -i passwords.txt -o out -f 12.09.2015 -t 12.10.2016
 */

app
	.version('2.0.0')
	.option('-i, --input [file]', 'файл с учетными данными вида логин;пароль на каждой строчке')
	.option('-o, --output [dir]', 'папка, куда записывать результат')
	.option('-f, --from [date]', 'с какого момента нужны сообщения (DD.MM.YY)')
	.option('-t, --to [date]', 'до какого момента нужны сообщения (DD.MM.YY)')
	.parse(process.argv);

const date_from = moment(app.from, "DD.MM.YY").format("MMM DD, YYYY");
const date_to = moment(app.to, "DD.MM.YY").format("MMM DD, YYYY");

const fetch_user = (user, password) => {
	const getServer = (email) => {
		const host = email.split('@').pop();
		const known = {
			"list.ru": "imap.mail.ru",
			"bk.ru": "imap.mail.ru",
			"inbox.ru": "imap.mail.ru",
			"derpy.ru": "imap.yandex.ru"
		};
		if (known.hasOwnProperty(host))
			return known[host];
		return `imap.${host}`;
	};

	const imap = new Imap({
		user: user,
		password: password,
		host: getServer(user),
		port: 993,
		tls: true
		//,debug: function(msg){console.log('imap:', msg);}
	});

	const toUpper = (thing) => {
		return thing && thing.toUpperCase ? thing.toUpperCase() : thing
	};

	const findAttachmentParts = (struct, attachments) => {
		attachments = attachments ||  [];
		for (let i = 0, len = struct.length, r; i < len; ++i)
			if (Array.isArray(struct[i]))
				findAttachmentParts(struct[i], attachments);
			else
			if (struct[i].disposition && ['INLINE', 'ATTACHMENT'].indexOf(toUpper(struct[i].disposition.type)) > -1)
				attachments.push(struct[i]);
		return attachments;
	};

	const buildDownloaderFunction = (attachment) => {
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
				mkdirp.sync(`${app.output}/${user}`);
				const writeStream = fs.createWriteStream(`${app.output}/${user}/${filename}`);
				if (toUpper(encoding) === 'BASE64')
					stream.pipe(new base64.Base64Decode()).pipe(writeStream);
				else
					stream.pipe(writeStream);

			});
			msg.on('error', () => console.log('[!] Ошибка получения %s', filename));
			msg.once('end', () => console.log('[+] Завершено %s', filename));
		};
	};

	imap.once('ready', () => {
		imap.openBox('INBOX', true, (err, box) => {
			if (err) throw err;
			imap.search([['SINCE', date_from], ['BEFORE', date_to]], (err, results) => {
				if (err) throw err;
				const f = imap.fetch(results, {
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
							f.on('message', buildDownloaderFunction(attachment));
						}
					});
					msg.on('error', () => console.log('[!] Метаданные %d не получены', seqno));
				});
				f.on('error', err => console.log('[!] Ошибка получения метаданных', err));
				f.once('end', () => (console.log('[+] Все метаданные получены'), imap.end()));
			});
		});
	});

	return new Promise((f,r) => {
		imap.on('error', err => console.log('[!] Ошибка IMAP', err));
		imap.once('end', () =>  (console.log('[+] Загрузка завершена'), f()));
		imap.connect();
	});
};

const main = async () => {
	let lines = [];
	try {
		lines = fs.readFileSync(app.input, {encoding: 'utf8'}).split('\n');
	} catch (e) {
		console.log('[!] Не удалось прочитать файл с логинами, укажите параметр --input корректно');
	}
	for (let line of lines)
		await fetch_user.apply(null, line.split(';'));
};

main();
