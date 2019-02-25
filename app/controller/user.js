const jwt = require('jsonwebtoken')
const Mastodon = require('mastodon-api')

const User = require('../models/user')
const { Event, Tag, Place } = require('../models/event')
const config = require('../config')
const mail = require('../mail')
const bot = require('./bot')

const userController = {
  async login (req, res) {
    // find the user
    const user = await User.findOne({where: { email: req.body.email }})
    if (!user) {
      res.status(404).json({ success: false, message: 'AUTH_FAIL' })
    } else if (user) {
      if (!user.is_active) {
        res.status(403).json({success: false, message: 'NOT)CONFIRMED'})
      }
      // check if password matches
      else if (!await user.comparePassword(req.body.password)) {
        res.status(403).json({ success: false, message: 'AUTH_FAIL' })
      } else {
        // if user is found and password is right
        // create a token
        const payload = { email: user.email }
        var token = jwt.sign(payload, config.secret)
        res.json({
          success: true,
          message: 'Enjoy your token!',
          token,
          user
        })
      }
    }
  },

  async setToken (req, res) {
    req.user.mastodon_auth = req.body
    await req.user.save()
    res.json(req.user)
  },

  async delEvent (req, res) {
    //check if event is mine
    const event = await Event.findByPk(req.params.id)
    if (event && (req.user.is_admin || req.user.id === event.userId))
    {
      await event.destroy()
      res.sendStatus(200)
    } else {
      res.sendStatus(404)
    }
  },

  async addEvent (req, res, next) {
    const body = req.body
    const eventDetails = {
      title: body.title,
      description: body.description,
      multidate: body.multidate,
      start_datetime: body.start_datetime,
      end_datetime: body.end_datetime
    }

    if (req.file) {
      eventDetails.image_path = req.file.path
    }

    //create place
    let place
    try {
      place = await Place.findOrCreate({where: {name: body.place_name}, 
        defaults: {address: body.place_address }})
      .spread((place, created) => place)
    } catch(e) {
      console.log(e)
    }
    let event = await Event.create(eventDetails)
    await event.setPlace(place)
    
    // create/assign tags
    console.log(body.tags)
    if (body.tags) {
      await Tag.bulkCreate(body.tags.map(t => ({ tag: t})), {ignoreDuplicates: true})
      const tags = await Tag.findAll({where: { tag: body.tags }})
      await event.addTags(tags)
    }
    await req.user.addEvent(event)
    event = await Event.findByPk(event.id, {include: [User, Tag, Place]})
    // check if bot exists
    if (req.user.mastodon_auth) {
      const post = await bot.post(req.user, event)
    }
    return res.json(event)
  },

  async updateEvent (req, res) {
    const body = req.body
    const event = await Event.findByPk(body.id)
    await event.update(body)
    let place
    try {
      place = await Place.findOrCreate({where: {name: body.place_name}, 
        defaults: {address: body.place_address }})
      .spread((place, created) => place)
    } catch(e) {
      console.log('catch', e)
    }
    await event.setPlace(place)
    await event.setTags([])
    console.log(body.tags)
    if (body.tags) {
      await Tag.bulkCreate(body.tags.map(t => ({ tag: t})), {ignoreDuplicates: true})
      const tags = await Tag.findAll({where: { tag: body.tags }})
      await event.addTags(tags)
    }    
    const newEvent = await Event.findByPk(event.id, {include: [User, Tag, Place]})
    // check if bot exists
    if (req.user.mastodon_auth) {
      const post = await bot.post(req.user, newEvent)
    }    
    return res.json(newEvent)
  },

  async getMyEvents (req, res) {
    const events = await req.user.getEvents()
    res.json(events)
  },

  async getAuthURL (req, res) {
    const instance = req.body.instance
    const { client_id, client_secret } = await Mastodon.createOAuthApp(`https://${instance}/api/v1/apps`, 'eventi', 'read write', `${config.baseurl}/settings`)
    const url = await Mastodon.getAuthorizationUrl(client_id, client_secret, `https://${instance}`, 'read write', `${config.baseurl}/settings`)
    console.log(req.user)
    req.user.instance = instance
    req.user.mastodon_auth = { client_id, client_secret }
    await req.user.save()
    res.json(url)
  },

  async code (req, res) {
    const code = req.body.code
    const { client_id, client_secret } = req.user.mastodon_auth
    const instance = req.user.instance
    try {
      const token = await Mastodon.getAccessToken(client_id, client_secret, code, `https://${instance}`, '${config.baseurl}/settings')
      const mastodon_auth = { client_id, client_secret, access_token: token}
      req.user.mastodon_auth = mastodon_auth
      await req.user.save()
      await botController.add(token)
      res.json(req.user)
    } catch (e) {
      res.json(e)
    }
  },

  async current (req, res) {
    res.json(req.user)
  },

  async getAll (req, res) {
    const users = await User.findAll({
      order: [['createdAt', 'DESC']]
    })
    res.json(users)
  },

  async update (req, res) {
    const user = await User.findByPk(req.body.id)
    if (user) {
      await user.update(req.body)
      res.json(user)
    } else {
      res.send(400)
    }
  },

  async register (req, res) {
    try {
      req.body.is_active = false
      const user = await User.create(req.body)
      try {
        mail.send(user.email, 'register', { user })
      } catch (e) {
        console.log(e)
        return res.status(400).json(e)
      }
      const payload = { email: user.email }
      const token = jwt.sign(payload, config.secret)
      res.json({ user, token })
    } catch (e) {
      res.status(404).json(e)
    }
  }
}

module.exports = userController
