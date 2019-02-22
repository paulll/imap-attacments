Скачивает все вложения с данного почтового ящика в текущую директорию.

## Зависимости:
- node.js
- npm

## Установка:
```
git clone https://github.com/paulll/imap-attacments
cd imap-attachments
npm i .
```

## Использование:
```
# в папке проекта
mkdir downloaded_files
cd downloaded_files
node .. -u user@mail.ru -p mYpassw0rd -h imap.mail.ru
```