const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Op } = require('sequelize')
const sanitizeHtml = require('sanitize-html')
const config = require('config')
const mail = require('../mail')
const { user: User, event: Event, tag: Tag, place: Place } = require('../models')
const settingsController = require('./settings')
const eventController = require('./event')
const debug = require('debug')('user:controller')

const userController = {
  async delEvent (req, res) {
    const event = await Event.findByPk(req.params.id)
    // check if event is mine (or user is admin)
    if (event && (req.user.is_admin || req.user.id === event.userId)) {
      if (event.image_path) {
        const old_path = path.join(config.upload_path, event.image_path)
        const old_thumb_path = path.join(config.upload_path, 'thumb', event.image_path)
        try {
          fs.unlinkSync(old_thumb_path)
          fs.unlinkSync(old_path)
        } catch (e) {
          debug(e)
        }
      }
      const notifier = require('../../notifier')
      await notifier.notifyEvent('Delete', event.id)
      await event.destroy()
      res.sendStatus(200)
    } else {
      res.sendStatus(403)
    }
  },

  /**
   * add event
   */
  async addEvent (req, res) {
    // req.err comes from multer streaming error
    if (req.err) {
      debug(req.err)
      return res.status(400).json(req.err.toString())
    }

    try {
      const body = req.body
      const recurrent = body.recurrent ? JSON.parse(body.recurrent) : null

      const eventDetails = {
        title: body.title,
        // remove html tags
        description: sanitizeHtml(body.description),
        multidate: body.multidate,
        start_datetime: body.start_datetime,
        end_datetime: body.end_datetime,
        recurrent,
        // publish this event only if authenticated
        is_visible: !!req.user
      }

      if (req.file) {
        eventDetails.image_path = req.file.filename
      }

      const event = await Event.create(eventDetails)

      // create place if needed
      const place = await Place.findOrCreate({
        where: { name: body.place_name },
        defaults: { address: body.place_address }
      })
        .spread((place, created) => place)
      await event.setPlace(place)
      event.place = place

      // create/assign tags
      if (body.tags) {
        await Tag.bulkCreate(body.tags.map(t => ({ tag: t })), { ignoreDuplicates: true })
        const tags = await Tag.findAll({ where: { tag: { [Op.in]: body.tags } } })
        await Promise.all(tags.map(t => t.update({ weigth: Number(t.weigth) + 1 })))
        await event.addTags(tags)
        event.tags = tags
      }

      // associate user to event and reverse
      if (req.user) {
        await req.user.addEvent(event)
        await event.setUser(req.user)
      }

      // create recurrent instances of event if needed
      // without waiting for the task manager
      if (event.recurrent) {
        eventController._createRecurrent()
      }

      // return created event to the client
      res.json(event)

      // send notification (mastodon/email)
      // only if user is authenticated
      if (req.user) {
        const notifier = require('../../notifier')
        notifier.notifyEvent('Create', event.id)
      }
    } catch (e) {
      res.sendStatus(400)
      debug(e)
    }
  },

  async updateEvent (req, res) {
    if (req.err) {
      return res.status(400).json(req.err.toString())
    }
    const body = req.body
    const event = await Event.findByPk(body.id)
    if (!req.user.is_admin && event.userId !== req.user.id) {
      return res.sendStatus(403)
    }

    if (req.file) {
      if (event.image_path) {
        const old_path = path.resolve(config.upload_path, event.image_path)
        const old_thumb_path = path.resolve(config.upload_path, 'thumb', event.image_path)
        await fs.unlink(old_path, e => console.error(e))
        await fs.unlink(old_thumb_path, e => console.error(e))
      }
      body.image_path = req.file.filename
    }

    body.description = sanitizeHtml(body.description)

    await event.update(body)
    let place
    try {
      place = await Place.findOrCreate({
        where: { name: body.place_name },
        defaults: { address: body.place_address }
      }).spread((place, created) => place)
    } catch (e) {
      console.log('error', e)
    }
    await event.setPlace(place)
    await event.setTags([])
    if (body.tags) {
      await Tag.bulkCreate(body.tags.map(t => ({ tag: t })), { ignoreDuplicates: true })
      const tags = await Tag.findAll({ where: { tag: { [Op.in]: body.tags } } })
      await event.addTags(tags)
    }
    const newEvent = await Event.findByPk(event.id, { include: [Tag, Place] })
    res.json(newEvent)
    const notifier = require('../../notifier')
    notifier.notifyEvent('Update', event.id)
  },

  async forgotPassword (req, res) {
    const email = req.body.email
    const user = await User.findOne({ where: { email: { [Op.eq]: email } } })
    if (!user) { return res.sendStatus(200) }

    user.recover_code = crypto.randomBytes(16).toString('hex')
    mail.send(user.email, 'recover', { user, config }, req.settings.locale)

    await user.save()
    res.sendStatus(200)
  },

  async checkRecoverCode (req, res) {
    const recover_code = req.body.recover_code
    if (!recover_code) { return res.sendStatus(400) }
    const user = await User.findOne({ where: { recover_code: { [Op.eq]: recover_code } } })
    if (!user) { return res.sendStatus(400) }
    res.sendStatus(200)
  },

  async updatePasswordWithRecoverCode (req, res) {
    const recover_code = req.body.recover_code
    const password = req.body.password
    if (!recover_code || !password) { return res.sendStatus(400) }
    const user = await User.findOne({ where: { recover_code: { [Op.eq]: recover_code } } })
    if (!user) { return res.sendStatus(400) }
    try {
      await user.update({ recover_code: '', password })
      res.sendStatus(200)
    } catch (e) {
      res.sendStatus(400)
    }
  },

  async current (req, res) {
    if (!req.user) { return res.status(400).send('Not logged') }
    const user = await User.scope('withoutPassword').findByPk(req.user.id)
    res.json(user)
  },

  async getAll (req, res) {
    const users = await User.scope('withoutPassword').findAll({
      order: [['is_admin', 'DESC'], ['createdAt', 'DESC']]
    })
    res.json(users)
  },

  async update (req, res) {
    // user to modify
    const user = await User.findByPk(req.body.id)

    if (!user) { return res.status(404).json({ success: false, message: 'User not found!' }) }

    if (req.body.id !== req.user.id && !req.user.is_admin) {
      return res.status(400).json({ succes: false, message: 'Not allowed' })
    }

    if (!req.body.password) { delete req.body.password }

    if (!user.is_active && req.body.is_active && user.recover_code) {
      mail.send(user.email, 'confirm', { user, config }, req.settings.locale)
    }

    await user.update(req.body)
    res.json(user)
  },

  async register (req, res) {
    if (!settingsController.settings.allow_registration) { return res.sendStatus(404) }
    const n_users = await User.count()
    try {
      // the first registered user will be an active admin
      if (n_users === 0) {
        req.body.is_active = req.body.is_admin = true
      } else {
        req.body.is_active = false
      }

      req.body.recover_code = crypto.randomBytes(16).toString('hex')
      debug('Register user ', req.body.email)
      const user = await User.create(req.body)
      debug(`Sending registration email to ${user.email}`)
      mail.send(user.email, 'register', { user, config }, req.settings.locale)
      mail.send(config.admin_email, 'admin_register', { user, config }, req.settings.locale)
      res.sendStatus(200)
    } catch (e) {
      res.status(404).json(e)
    }
  },

  async create (req, res) {
    try {
      req.body.is_active = true
      req.body.recover_code = crypto.randomBytes(16).toString('hex')
      const user = await User.create(req.body)
      mail.send(user.email, 'user_confirm', { user, config }, req.settings.locale)
      res.json(user)
    } catch (e) {
      res.status(404).json(e)
    }
  },

  async remove (req, res) {
    try {
      const user = await User.findByPk(req.params.id)
      user.destroy()
      res.sendStatus(200)
    } catch (e) {
      res.status(404).json(e)
    }
  }
}

module.exports = userController
