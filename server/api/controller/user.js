const crypto = require('crypto')
const { Op } = require('sequelize')
const config = require('config')
const mail = require('../mail')
const { user: User } = require('../models')
const settingsController = require('./settings')
const debug = require('debug')('user:controller')

const userController = {

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
