const mail = require('./api/mail')
const bot = require('./api/controller/bot')
const settingsController = require('./api/controller/settings')
const config = require('config')
const eventController = require('./api/controller/event')
const get = require('lodash/get')

const { event: Event, notification: Notification,  event_notification: EventNotification,
  user: User, place: Place, tag: Tag } = require('./api/models')

const notifier = {
  async sendNotification(notification, event) {
    console.error('dentro sendNotification ', settingsController.settings, notification.type)
    const access_token = get(settingsController.secretSettings, 'mastodon_auth.access_token')
    const instance = get(settingsController.settings, 'mastodon_instance')    
    const promises = []
    switch (notification.type) {
      case 'mail':
      return mail.send(notification.email, 'event', { event, config, notification })
     case 'admin_email':
        const admins = await User.findAll({ where: { is_admin: true } })
       const admin_emails = admins.map(admin => admin.email)
       return mail.send(admin_emails, 'event', { event, to_confirm: true, notification })
      case 'mastodon':
        // instance publish
        if (instance && access_token) {
          const b = bot.post(instance, access_token, event).then(b => {
            console.error(b)
            event.activitypub_id = b.data.id
            return event.save()
          }).catch(e => {
            console.error("ERRORE !! ", e)
          })
          promises.push(b)
        }
    }
    return Promise.all(promises)
  },
  async notifyEvent(eventId) {
    const event = await Event.findByPk(eventId, {
      include: [ Tag, Place, User ]
    })

    // insert notifications
    const notifications = await eventController.getNotifications(event)
    const a = await event.setNotifications(notifications)

    const eventNotifications = await EventNotification.findAll({
      where: {
        notificationId: notifications.map(n=>n.id),
        status: 'new'
      }
    })

    const promises = eventNotifications.map(async e => {
      const notification = await Notification.findByPk(e.notificationId)
      try {
        await notifier.sendNotification(notification, event)
        e.status = 'sent'
      } catch (err) {
        console.error(err)
        e.status = 'error'
        // e.error = err
      }
      return e.save()
    })
  
    return Promise.all(promises)
  },
  async  notify() {
    // get all event notification in queue
    const eventNotifications = await EventNotification.findAll({ where: { status: 'new' } })
    const promises = eventNotifications.map(async e => {
      const event = await Event.findByPk(e.eventId, { include: [User, Place, Tag] })
      if (!event.place) return
      const notification = await Notification.findByPk(e.notificationId)
      try {
        await sendNotification(notification, event, e)
        e.status = 'sent'
        return e.save()
      } catch (err) {
        console.error(err)
        e.status = 'error'
        // e.error = err
        return e.save()
      }
    })
    return Promise.all(promises)
  }
}

// let interval
// function startLoop(seconds) {
//   interval = setInterval(notify, seconds * 1000)
// }

// startLoop(26000)

module.exports = notifier
// export default notifier