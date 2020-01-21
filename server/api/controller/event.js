const crypto = require('crypto')
const moment = require('moment-timezone')
const { Op } = require('sequelize')
const _ = require('lodash')
const { event: Event, resource: Resource, tag: Tag, place: Place, notification: Notification } = require('../models')
const Sequelize = require('sequelize')
const exportController = require('./export')
const debug = require('debug')('controller:event')

const eventController = {

  /** add a resource to event
   * @todo not used anywhere, should we use with webmention?
   * @todo should we use this for roply coming from fediverse?
   */
  // async addComment (req, res) {
  //   // comments could be added to an event or to another comment
  //   let event = await Event.findOne({ where: { activitypub_id: { [Op.eq]: req.body.id } } })
  //   if (!event) {
  //     const comment = await Resource.findOne({ where: { activitypub_id: { [Op.eq]: req.body.id } }, include: Event })
  //     event = comment.event
  //   }
  //   const comment = new Comment(req.body)
  //   event.addComment(comment)
  //   res.json(comment)
  // },

  async getMeta (req, res) {
    const places = await Place.findAll({
      order: [[Sequelize.literal('weigth'), 'DESC']],
      attributes: {
        include: [[Sequelize.fn('count', Sequelize.col('events.placeId')), 'weigth']],
        exclude: ['createdAt', 'updatedAt']
      },
      include: [{ model: Event, attributes: [] }],
      group: ['place.id']
    })

    const tags = await Tag.findAll({
      raw: true,
      order: [['weigth', 'DESC']],
      attributes: {
        exclude: ['createdAt', 'updatedAt']
      }
    })

    res.json({ tags, places })
  },

  async getNotifications (event, action) {
    debug('getNotifications "%s" (%s)', event.title, action)
    function match (event, filters) {
      // matches if no filter specified
      if (!filters) { return true }

      // check for visibility
      if (typeof filters.is_visible !== 'undefined' && filters.is_visible !== event.is_visible) { return false }

      if (!filters.tags && !filters.places) { return true }
      if (!filters.tags.length && !filters.places.length) { return true }
      if (filters.tags.length) {
        const m = _.intersection(event.tags.map(t => t.tag), filters.tags)
        if (m.length > 0) { return true }
      }
      if (filters.places.length) {
        if (filters.places.find(p => p === event.place.name)) {
          return true
        }
      }
    }

    const notifications = await Notification.findAll({ where: { action }, include: [Event] })

    // get notification that matches with selected event
    const ret = notifications.filter(notification => match(event, notification.filters))
    return ret
  },

  async updatePlace (req, res) {
    const place = await Place.findByPk(req.body.id)
    await place.update(req.body)
    res.json(place)
  },

  // TODO retrieve next/prev event also
  // select id, start_datetime, title from events where start_datetime > (select start_datetime from events where id=89) order by start_datetime limit 20;
  async get (req, res) {
    const format = req.params.format || 'json'
    const is_admin = req.user && req.user.is_admin
    const id = Number(req.params.event_id)
    let event = await Event.findByPk(id, {
      attributes: {
        exclude: ['createdAt', 'updatedAt']
      },
      include: [
        { model: Tag, attributes: ['tag', 'weigth'], through: { attributes: [] } },
        { model: Place, attributes: ['name', 'address'] },
        { model: Resource, where: !is_admin && { hidden: false }, required: false }
      ],
      order: [[Resource, 'id', 'DESC']]
    })

    if (event && (event.is_visible || is_admin)) {
      event = event.toJSON()
      event.tags = event.tags.map(t => t.tag)
      if (format === 'json') {
        res.json(event)
      } else if (format === 'ics') {
        // last arg is alarms/reminder, ref: https://github.com/adamgibbons/ics#attributes (alarms)
        exportController.ics(req, res, [event], [{
          action: 'display',
          trigger: { hours: 1, before: true }
        }])
      }
    } else {
      res.sendStatus(404)
    }
  },

  /** confirm an anonymous event
   * and send its relative notifications
   */
  async confirm (req, res) {
    const id = Number(req.params.event_id)
    const event = await Event.findByPk(id)
    if (!event) { return res.sendStatus(404) }
    if (!req.user.is_admin && req.user.id !== event.userId) {
      return res.sendStatus(403)
    }

    try {
      event.is_visible = true
      await event.save()

      res.sendStatus(200)

      // send notification
      const notifier = require('../../notifier')
      notifier.notifyEvent('Create', event.id)
    } catch (e) {
      res.sendStatus(404)
    }
  },

  async unconfirm (req, res) {
    const id = Number(req.params.event_id)
    const event = await Event.findByPk(id)
    if (!event) { return req.sendStatus(404) }
    if (!req.user.is_admin && req.user.id !== event.userId) {
      return res.sendStatus(403)
    }

    try {
      event.is_visible = false
      await event.save()
      res.sendStatus(200)
    } catch (e) {
      res.sendStatus(404)
    }
  },

  /** get all unconfirmed events */
  async getUnconfirmed (req, res) {
    const events = await Event.findAll({
      where: {
        is_visible: false
      },
      order: [['start_datetime', 'ASC']],
      include: [Tag, Place]
    })
    res.json(events)
  },

  async addNotification (req, res) {
    try {
      const notification = {
        filters: { is_visible: true },
        email: req.body.email,
        type: 'mail',
        remove_code: crypto.randomBytes(16).toString('hex')
      }
      await Notification.create(notification)
      res.sendStatus(200)
    } catch (e) {
      res.sendStatus(404)
    }
  },

  async delNotification (req, res) {
    const remove_code = req.params.code
    try {
      const notification = await Notification.findOne({ where: { remove_code: { [Op.eq]: remove_code } } })
      await notification.destroy()
    } catch (e) {
      return res.sendStatus(404)
    }
    res.sendStatus(200)
  },

  async addRecurrent (start, places, where_tags, limit) {
    const where = {
      is_visible: true,
      recurrent: { [Op.ne]: null }
      // placeId: places
    }

    const events = await Event.findAll({
      where,
      limit,
      attributes: {
        exclude: ['slug', 'likes', 'boost', 'userId', 'is_visible', 'description', 'createdAt', 'updatedAt', 'placeId']
      },
      order: ['start_datetime', [Tag, 'weigth', 'DESC']],
      include: [
        { model: Resource, required: false, attributes: ['id'] },
        { model: Tag, ...where_tags, attributes: ['tag'], through: { attributes: [] } },
        { model: Place, required: false, attributes: ['id', 'name', 'address'] }
      ]
    })

    debug(`Found ${events.length} recurrent events`)
    let allEvents = []
    _.forEach(events, e => {
      allEvents = allEvents.concat(eventController.createEventsFromRecurrent(e.get(), start))
    })

    debug(`Created ${allEvents.length} events`)
    return allEvents
  },

  // build singular events from a recurrent pattern
  createEventsFromRecurrent (e, start, dueTo = null) {
    const events = []
    const recurrent = JSON.parse(e.recurrent)
    if (!recurrent.frequency) { return false }
    if (!dueTo) {
      dueTo = moment.unix(start).add(2, 'month')
    }
    let cursor = moment.unix(start).startOf('week')
    const start_date = moment.unix(e.start_datetime)
    const duration = moment.unix(e.end_datetime).diff(start_date, 's')
    const frequency = recurrent.frequency
    const days = recurrent.days
    const type = recurrent.type

    // default frequency is '1d' => each day
    const toAdd = { n: 1, unit: 'day' }

    // each week or 2 (search for the first specified day)
    if (frequency === '1w' || frequency === '2w') {
      cursor.add(days[0] - 1, 'day')
      if (frequency === '2w') {
        const nWeeks = cursor.diff(e.start_datetime, 'w') % 2
        if (!nWeeks) { cursor.add(1, 'week') }
      }
      toAdd.n = Number(frequency[0])
      toAdd.unit = 'week'
      // cursor.set('hour', start_date.hour()).set('minute', start_date.minutes())
    }

    cursor.set('hour', start_date.hour()).set('minute', start_date.minutes())

    // each month or 2
    if (frequency === '1m' || frequency === '2m') {
      // find first match
      toAdd.n = 1
      toAdd.unit = 'month'
      if (type === 'weekday') {

      } else if (type === 'ordinal') {

      }
    }

    // add event at specified frequency
    while (true) {
      const first_event_of_week = cursor.clone()
      days.forEach(d => {
        if (type === 'ordinal') {
          cursor.date(d)
        } else {
          cursor.day(d - 1)
        }
        if (cursor.isAfter(dueTo) || cursor.isBefore(start)) { return }
        e.start_datetime = cursor.unix()
        e.end_datetime = e.start_datetime + duration
        events.push(Object.assign({}, e))
      })
      if (cursor.isAfter(dueTo)) { break }
      cursor = first_event_of_week.add(toAdd.n, toAdd.unit)
      cursor.set('hour', start_date.hour()).set('minute', start_date.minutes())
    }

    return events
  },

  /**
   * Select events based on params
   */
  async select (req, res) {
    const start = req.query.start || moment().unix()
    const limit = req.query.limit || 100
    const show_recurrent = req.query.show_recurrent || true
    const filter_tags = req.query.tags || ''
    const filter_places = req.query.places || ''

    debug(`select limit:${limit} rec:${show_recurrent} tags:${filter_tags} places:${filter_places}`)
    let where_tags = {}
    const where = {
      // confirmed event only
      is_visible: true,
      start_datetime: { [Op.gt]: start },
      recurrent: null
    }

    if (filter_tags) {
      where_tags = { where: { tag: filter_tags.split(',') } }
    }

    if (filter_places) {
      where.placeId = filter_places.split(',')
    }

    let events = await Event.findAll({
      where,
      limit,
      attributes: {
        exclude: ['slug', 'likes', 'boost', 'userId', 'is_visible', 'description', 'createdAt', 'updatedAt', 'placeId']
        // include: [[Sequelize.fn('COUNT', Sequelize.col('activitypub_id')), 'ressources']]
      },
      order: ['start_datetime', [Tag, 'weigth', 'DESC']],
      include: [
        { model: Resource, required: false, attributes: ['id'] },
        { model: Tag, ...where_tags, attributes: ['tag'], through: { attributes: [] } },
        { model: Place, required: false, attributes: ['id', 'name', 'address'] }
      ]
    })

    let recurrentEvents = []
    events = _.map(events, e => e.get())
    if (show_recurrent) {
      recurrentEvents = await eventController.addRecurrent(start, where.placeId, where_tags, limit)
      events = _.concat(events, recurrentEvents)
    }

    // flat tags
    events = _(events).map(e => {
      e.tags = e.tags.map(t => t.tag)
      return e
    })
    // allEvents.sort((a,b) => a.start_datetime-b.start_datetime)
    res.json(events.sort((a, b) => a.start_datetime - b.start_datetime))
    // res.json(recurrentEvents)
  }

  // async getAll (req, res) {
  //   // this is due how v-calendar shows dates
  //   const start = moment()
  //     .year(req.params.year)
  //     .month(req.params.month)
  //     .startOf('month')
  //     .startOf('week')

  //   let end = moment()
  //     .year(req.params.year)
  //     .month(req.params.month)
  //     .endOf('month')

  //   const shownDays = end.diff(start, 'days')
  //   if (shownDays <= 35) { end = end.add(1, 'week') }
  //   end = end.endOf('week')

  //   let events = await Event.findAll({
  //     where: {
  //       // return only confirmed events
  //       is_visible: true,
  //       [Op.or]: [
  //         // return all recurrent events regardless start_datetime
  //         { recurrent: { [Op.ne]: null } },

  //         // and events in specified range
  //         { start_datetime: { [Op.between]: [start.unix(), end.unix()] } }
  //       ]
  //     },
  //     attributes: { exclude: ['createdAt', 'updatedAt', 'placeId'] },
  //     order: [[Tag, 'weigth', 'DESC']],
  //     include: [
  //       { model: Resource, required: false, attributes: ['id'] },
  //       { model: Tag, required: false },
  //       { model: Place, required: false, attributes: ['id', 'name', 'address'] }
  //     ]
  //   })
  //   events = events.map(e => e.get()).map(e => {
  //     e.tags = e.tags.map(t => t.tag)
  //     return e
  //   })

  //   let allEvents = events.filter(e => !e.recurrent || e.recurrent.length === 0)
  //   events.filter(e => e.recurrent && e.recurrent.length).forEach(e => {
  //     const events = createEventsFromRecurrent(e, end)
  //     if (events) { allEvents = allEvents.concat(events) }
  //   })

  //   // allEvents.sort((a,b) => a.start_datetime-b.start_datetime)
  //   res.json(allEvents.sort((a, b) => a.start_datetime - b.start_datetime))
  // }

}

module.exports = eventController
