const express = require('express')
const router = express.Router()
const config = require('config')
const cors = require('cors')
const Follows = require('./follows')
const Users = require('./users')
const { event: Event, user: User } = require('../api/models')
const Comments = require('./comments')
const Helpers = require('./helpers')
const Ego = require('./ego')

/**
 * Federation is calling!
 * ref: https://www.w3.org/TR/activitypub/#Overview
 */
router.use(cors())
router.use(express.json({type: ['application/json', 'application/activity+json', 'application/ld+json; profile="https://www.w3.org/ns/activitystreams"']}))


router.get('/m/:event_id', async (req, res) => {
  const event_id = req.params.event_id
  if (req.accepts('html')) return res.redirect(301, `/event/${event_id}`)

  console.error('Not asked for html!')
  const event = await Event.findByPk(req.params.event_id, { include: [ User ] })
  if (!event) return res.status(404).send('Not found')
  return res.json(event.toAP(event.user.username))
})

// get any message coming from federation
// Federation is calling!
router.post('/u/:name/inbox', Helpers.verifySignature, async (req, res) => {

  const b = req.body
  console.error('> INBOX ', b.type, b)
  const targetOrigin = new URL(b.actor).origin
  const domain = new URL(config.baseurl).host

  switch(b.type) {
    case 'Follow':
      Follows.follow(req, res, b, targetOrigin, domain)
      break
    case 'Undo':
      // unfollow || unlike
      if (b.object.type === 'Follow') {
        Follows.unfollow(req, res, b, targetOrigin, domain)
      } else if (b.object.type === 'Like') {
        console.error('Unlike!')
      } else if (b.object.type === 'Announce') {
        console.error('Unboost')
      }
      break
    case 'Announce':
      Ego.boost(req, res)
      break
    case 'Note':
      console.error('This is a note ! I probably should not receive this')
      break
    case 'Like':
      Ego.like(req, res)
      break
    case 'Delete':
      console.error('Delete ?!?!')
      break
    case 'Create':
      // this is a reply
      if (b.object.type === 'Note' && b.object.inReplyTo) {
        await Comments.create(b)
        res.sendStatus(201)
      } else {
        console.error('Create what? ', b.object.type)
      }
      break
  }
})

router.get('/u/:name/outbox', Users.outbox)
router.get('/u/:name/followers', Users.followers)
router.get('/u/:name', Users.get)

module.exports = router
