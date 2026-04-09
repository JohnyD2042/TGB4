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
| `ONLY_NOTIFY_ON_CHANGE` | нет | `1` (по умолчанию) — писать в Telegram только при смене статуса; `0` — при каждом успешном запуске |

6. **Settings** → **Networking** → **Generate Domain**, чтобы был публичный URL (скопируйте его для шага ниже).
7. **Cron**: в проекте **New** → **Cron** → расписание, например раз в сутки (`0 14 * * *` = 14:00 UTC) → тип **HTTP Request**, метод **GET**, URL:

   `https://ВАШ-ДОМЕН.up.railway.app/run?secret=ТОТ_ЖЕ_CRON_SECRET`  

   (подставьте домен из шага 6 и **тот же** `CRON_SECRET`, что в Variables).

После первого успешного деплоя откройте **Deployments → View logs**: должна быть строка `Listening on …`.

## Railway — быстрый тест

После деплоя вызовите проверку вручную (подставьте свой домен и секрет):

```text
https://ВАШ-ДОМЕН.railway.app/run?secret=ВАШ_CRON_SECRET
```

Ответ `200` и `"ok": true` означает успешный проход формы (или смотрите тело ответа в браузере / в логах).

## Уведомления в Telegram (необязательно)

В Variables Railway добавьте `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`. По умолчанию сообщение уходит только при **первом** успешном запуске или при **смене** текста статуса (`ONLY_NOTIFY_ON_CHANGE=0` — при каждом успехе).

Файл состояния `data/last-fingerprint.txt` на Railway **сбрасывается** при новом деплое, если не подключён том.
