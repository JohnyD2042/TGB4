# Migraciones — проверка статуса дела

Сервис на **Node.js** и **Playwright** поднимает HTTP-сервер: по защищённому запросу открывает [Consulta Unificada](https://www.migraciones.gob.ar/accesible/consultaTramitePrecaria/ConsultaUnificada.php), вводит номер дела и дату рождения и забирает текст результата.

## Локальная проверка

1. Установите [Node.js](https://nodejs.org/) 20+.
2. Скопируйте `config.local.example.json` в `config.local.json` и заполните поля (файл в `.gitignore`).
3. В каталоге проекта:

```bash
npm install
npm run check
```

В консоль выведется JSON с полем `ok`, `lines` (распарсенные строки) и при ошибке — `error`.

Без `config.local.json` можно задать переменные окружения: `EXPEDIENTE`, `FECHA_NACIMIENTO`, при необходимости `CONSULTA_URL`.

## Что создать в Railway

1. **Новый проект** (или существующий) → **New** → **GitHub Repo** и выберите репозиторий с этим кодом, либо **Empty Project** и подключите репоз позже.
2. **Сервис (Service)** с деплоем из репозитория: Railway подхватит [`Dockerfile`](Dockerfile) и соберёт образ с Chromium.
3. Во вкладке **Variables** добавьте (названия **точно** как в списке):

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `EXPEDIENTE` | да | Номер дела |
| `FECHA_NACIMIENTO` | да | Дата `DD/MM/YYYY` |
| `CRON_SECRET` | да | Длинная случайная строка; без неё `/run` вернёт 401 |
| `CONSULTA_URL` | нет | По умолчанию уже нужная ссылка на Consulta Unificada |
| `TELEGRAM_BOT_TOKEN` | нет | Для уведомлений |
| `TELEGRAM_CHAT_ID` | нет | Ваш chat id |
| `ONLY_NOTIFY_ON_CHANGE` | нет | `1` (по умолчанию) — писать в Telegram только при смене статуса; `0` — при каждом успешном запуске |

4. **Settings** → **Networking** → **Generate Domain**, чтобы был публичный URL.
5. **Cron** (в том же проекте): **New** → **Cron** → расписание, например `0 14 * * *` (раз в день в 14:00 UTC) → **HTTP Request**: URL вида `https://ВАШ-ДОМЕН.up.railway.app/run?secret=ТОТ_ЖЕ_CRON_SECRET` (метод GET).

После первого успешного деплоя откройте **Deployments → View logs**: должна быть строка `Listening on …`.

## Railway — быстрый тест

После деплоя вызовите проверку вручную (подставьте свой домен и секрет):

```text
https://ВАШ-ДОМЕН.railway.app/run?secret=ВАШ_CRON_SECRET
```

Ответ `200` и `"ok": true` означает успешный проход формы. Затем настройте **Cron** на этот URL раз в сутки.

## Уведомления в Telegram (необязательно)

В Variables Railway добавьте `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`. По умолчанию сообщение уходит только при **первом** успешном запуске или при **смене** текста статуса (`ONLY_NOTIFY_ON_CHANGE=0` — при каждом успехе).

Файл состояния `data/last-fingerprint.txt` на Railway **сбрасывается** при новом деплое, если не подключён том.
