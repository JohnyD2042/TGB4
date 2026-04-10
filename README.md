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

## Пошагово: залить код на GitHub (первый раз)

Файл `config.local.json` с вашими данными **не попадает в Git** (он в `.gitignore`). В GitHub уедет только код; **секреты потом внесите в Railway Variables**.

1. Зайдите на [github.com/new](https://github.com/new).
2. **Repository name:** например `migraciones-consulta-bot`.
3. Выберите **Private** (рекомендуется) или Public.
4. **Снимите** галочки «Add a README» и «Add .gitignore» — репозиторий должен быть **пустым**.
5. Нажмите **Create repository**.
6. На странице подсказки выберите **…or push an existing repository** и выполните **на своём Mac** в терминале (папка проекта `TGB4`), подставив свой логин и имя репозитория:

```bash
cd "/Users/ivanklykov/Desktop/AI camp/TGB4"
git remote add origin https://github.com/ВАШ_ЛОГИН/ИМЯ_РЕПО.git
git push -u origin main
```

Если спросит логин и пароль: для GitHub нужен **Personal Access Token** вместо пароля (настройки GitHub → Developer settings → Tokens), либо используйте **GitHub Desktop** и выполните push через приложение.

После успешного `git push` код будет на GitHub.

## Что создать в Railway

1. [railway.app](https://railway.app) → войти (лучше через **GitHub**).
2. **New Project** → **Deploy from GitHub repo** → разрешите Railway доступ к репозиториям → выберите репозиторий с этим проектом (например `migraciones-consulta-bot`).
3. Дождитесь **сборки по Dockerfile** (в логах не должно быть ошибки; образ с Playwright тяжёлый — первая сборка может занять несколько минут).
4. Дальше по списку ниже: **Variables**, **Domain**, **Cron**.
5. Во вкладке **Variables** у сервиса добавьте (названия **точно** как в списке):

| Переменная | Обязательно | Описание |
|------------|-------------|----------|
| `EXPEDIENTE` | да | Номер дела |
| `FECHA_NACIMIENTO` | да | Дата `DD/MM/YYYY` |
| `CRON_SECRET` | да | Длинная случайная строка; без неё `/run` вернёт 401 |
| `CONSULTA_URL` | нет | По умолчанию уже нужная ссылка на Consulta Unificada |
| `TELEGRAM_BOT_TOKEN` | нет | Для уведомлений |
| `TELEGRAM_CHAT_ID` | нет | Ваш chat id |
| `ONLY_NOTIFY_ON_CHANGE` | нет | Писать в Telegram только при смене статуса (по умолчанию). Чтобы слать **при каждом** запуске — в поле **значения** укажите только **`0`** (без знака `=`: в Railway имя и значение вводятся отдельно). |
| `DISABLE_INTERNAL_CRON` | нет | `1` — отключить встроенные 10:00/17:00 BA (если шлёте только `/run` снаружи) |

6. **Settings** → **Networking** → **Generate Domain**, чтобы был публичный URL (скопируйте его для шага ниже).
7. **Расписание проверок** — по умолчанию **внутри приложения** (см. ниже). Отдельный **Railway Cron не обязателен**.

После первого успешного деплоя откройте **Deployments → View logs**: должны быть строки `Listening on …` и `[scheduler] Activo: 10:00 y 17:00`.

## Два запуска в день (Буэнос-Айрес) и Telegram

### Встроенный расписатель (по умолчанию)

После старта сервера (`npm start` / Docker на Railway) автоматически запускаются **два таймера** в часовом поясе **America/Argentina/Buenos_Aires**:

- **10:00** — проверка Migraciones и при настроенном Telegram — уведомление (если выполняются условия ниже).
- **17:00** — то же самое.

Ничего настраивать в интерфейсе Railway Cron **не нужно**. В логах при старте: `[scheduler] Activo: 10:00 y 17:00 (America/Argentina/Buenos_Aires)...`.

**Важно:** контейнер должен **работать постоянно**. Если тариф «усыпляет» сервис без запросов, внутренний cron **не сработает** в спящие часы — тогда либо тариф без сна, либо внешний Cron Railway как резерв.

Отключить встроенный расписатель: переменная **`DISABLE_INTERNAL_CRON=1`** (например если используете только внешний вызов `/run`).

### Telegram

1. В Telegram откройте **@BotFather** → команда `/newbot` → сохраните **токен**.
2. Узнайте **chat id** (например бот **@userinfobot** или свой способ). Боту нужно разрешить писать вам (например **Start** в диалоге с ботом).
3. В Railway → **Variables** добавьте:
   - `TELEGRAM_BOT_TOKEN` — токен от BotFather  
   - `TELEGRAM_CHAT_ID` — числовой id чата (или группы)

**Как часто слать сообщения**

- **Только при смене** статуса (и при первом успешном запуске после сброса состояния) — **не** добавляйте `ONLY_NOTIFY_ON_CHANGE` или оставьте не `0`.
- **После каждой проверки** (удобно для двух запусков в день) — добавьте **`ONLY_NOTIFY_ON_CHANGE=0`**. Иначе второй запуск за день **без смены** статуса в Telegram **не шлётся** (в логах: `skip=only_notify_on_change_unchanged`).

Сообщение в Telegram содержит краткую строку статуса (дата и код последнего шага), как в поле `texto` ответа `/run`. При **ошибке** проверки (`"ok": false`) уведомление в Telegram **не** отправляется.

### Опционально: два Cron в Railway (резерв)

Если нужен запуск по HTTP без постоянного процесса, создайте два **Cron** с расписанием в **UTC** (BA −3): `0 13 * * *` и `0 20 * * *`, **GET** на `https://ВАШ-ДОМЕН/.../run?secret=ВАШ_CRON_SECRET`. Обычно это **не требуется**.

### Проверка после настройки

1. В Variables: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, для сообщения **каждый** раз в 10 и 17 — **`ONLY_NOTIFY_ON_CHANGE=0`**.
2. В логах после деплоя: `Listening on …` и `[scheduler] Activo…`.
3. Руками: откройте `/run?secret=…` — `"ok": true`; в Telegram должно прийти сообщение (при `ONLY_NOTIFY_ON_CHANGE=0` или первый раз / смена статуса).
4. В **10:00 или 17:00 по Буэнос-Айресу** смотрите логи: строки `[scheduler] 10:00 BA` / `17:00 BA`.

### Ошибка Telegram «Bad Request: chat not found»

Проверка Migraciones при этом может быть **успешной** — в JSON будет `"ok": true`, поля `fecha` / `estado` / `texto`, а при сбое доставки — **`telegramError`** (и `"notified": false`).

Что проверить:

1. Откройте **вашего** бота в Telegram и нажмите **Start** (иначе бот часто не может писать в личку).
2. **`TELEGRAM_CHAT_ID`** — это **ваш** числовой id (например из @userinfobot), **не** токен бота и не username.
3. В Railway в Variables значение **без кавычек** и без пробелов: одно число, для группы часто **отрицательное** (бот должен быть в группе).
4. Создавали бота заново — возможно в Railway старый токен; обновите **`TELEGRAM_BOT_TOKEN`**.

## Railway — быстрый тест

После деплоя вызовите проверку вручную (подставьте свой домен и секрет):

```text
https://ВАШ-ДОМЕН.railway.app/run?secret=ВАШ_CRON_SECRET
```

Ответ `200` и `"ok": true` означает успешный проход формы. Если сообщение в Telegram не ушло — в теле ответа будет **`telegramError`** (при этом Migraciones мог пройти успешно). Полная сводка — в разделе выше.

Файл состояния `data/last-fingerprint.txt` на Railway **сбрасывается** при новом деплое, если не подключён том (после деплоя возможен лишний «первый» Telegram при режиме только при смене).
