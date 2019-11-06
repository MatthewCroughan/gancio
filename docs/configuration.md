---
layout: default
title: Configuration
permalink: /config
nav_order: 3
---

# Configuration
{: .no_toc }
Main `gancio` configuration is done with a configuration file.
This shoud be a `.json` or a `.js` file and could be specified using the `--config` flag.

- <small>eg. `gancio start --config ./config.json`</small>
- <small>eg. `pm2 start gancio start -- --config ~/config.json`</small>

1. TOC
{:toc}

- ### Title
The title will be in rss feed, in html head and in emails:

`"title": "Gancio"`

![title](assets/title.png)

- ### Description
`"description": "a shared agenda for local communities"`

- ### BaseURL
URL where your site will be accessible (include http or https):  
`"baseurl": "https://gancio.cisti.org"`

- ### Server
This probably support unix socket too :D

```json
"server": {
    "host": "localhost",
    "port": 13120
}
```

- ### Database
DB configuration, look [here](https://sequelize.org/master/class/lib/sequelize.js~Sequelize.html#instance-constructor-constructor) for options.
```json
  "db": {
    "dialect": "sqlite",
    "storage": "/tmp/db.sqlite"
  }
```
- ### Upload path
Where to save images
`"upload_path": "./uploads"`

- ### SMTP
SMTP configuration.
Gancio should send emails at following events:
- the admin should receive emails of anon event (if enabled) to confirm them.
- the admin should receive emails of registration request (if enabled) to confirm them.
- an user should receive an email of registration requested.
- an user should receive an email of confirmed registration.
- an user should receive a confirmation email when subscribed directly by admin.

```json
"smtp": {
    "auth": {
      "user": "",
      "pass": ""
    },
    "secure": true,
    "host": ""
  }
```

- ### Admin_email
Email of administrator. Note that email from gancio comes from this email and that
the SMTP configuration above should allow to use this address as from.


- ### Favicon
You could specify another favicon. This is also used as logo (top-left
corner):   
`"favicon": "./favicon.ico"`

- ### User locale
Probably you want to modify some text for your specific community, that's
why we thought the `user_locale` configuration: you can specify your version of
each string of **gancio** making a directory with your locales inside.
For example, let's say you want to modify the text inside the `/about`
page:  
`mkdir /opt/gancio/user_locale`
put something like this in `/opt/gancio/user_locale/en.js` to override the about in
english:  
```js
export default {
      about: 'A new about'
}
```  
and then point the `user_locale` configuration to that directory:  
```json
"user_locale": "/opt/gancio/user_locale"
```  
Watch [here](https://framagit.org/les/gancio/tree/master/locales) for a
list of strings you can override.  
<small>:warning: Note that a restart is needed when you change
user_locale's content.</small>

- ### Secret


## Default settings
```json
{
  "title": "Gancio",
  "description": "A shared agenda for local communities",
  "baseurl": "http://localhost:13120",
  "server": {
    "host": "0.0.0.0",
    "port": 13120
  },
  "db": {
    "dialect": "sqlite",
    "storage": "/tmp/db.sqlite"
  },
  "upload_path": "./",
  "favicon": "../dist/favicon.ico",
  "smtp": {
    "auth": {
      "user": "",
      "pass": ""
    },
    "secure": true,
    "host": ""
  },
  "admin_email": "",
  "secret": "notsosecret"
}
```
