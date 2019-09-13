const fetch = require('node-fetch')
// const request = require('request')
const crypto = require('crypto')
const config = require('config')
const httpSignature = require('http-signature')
const debug = require('debug')('federation:helpers')
const { user: User, fed_users: FedUsers } = require('../api/models')
const url = require('url')
const settings = require('../api/controller/settings')

const Helpers = {

  // ignore unimplemented ping url from fediverse
  async spamFilter (req, res, next) {
    const urlToIgnore = [
      '/api/v1/instance',
      '/api/meta',
      '/api/statusnet/config.json',
      '/poco',
    ]
    if (urlToIgnore.includes(req.path)) return res.status(404).send('Not Found')
    next()
  },

  async signAndSend (message, user, to) {
    // get the URI of the actor object and append 'inbox' to it
    const toUrl = url.parse(to)
    // const toPath = toOrigin.path + '/inbox'
    // get the private key
    const privkey = user.rsa.privateKey
    const signer = crypto.createSign('sha256')
    const d = new Date()
    const stringToSign = `(request-target): post ${toUrl.path}\nhost: ${toUrl.hostname}\ndate: ${d.toUTCString()}`

    signer.update(stringToSign)
    signer.end()
    const signature = signer.sign(privkey)
    const signature_b64 = signature.toString('base64')
    const header = `keyId="${config.baseurl}/federation/u/${user.username}",headers="(request-target) host date",signature="${signature_b64}"`
    const ret = await fetch(to, {
      headers: {
        'Host': toUrl.hostname,
        'Date': d.toUTCString(),
        'Signature': header,
        'Content-Type': 'application/activity+json; charset=utf-8',
        'Accept': 'application/activity+json, application/json; chartset=utf-8'
      },
      method: 'POST',
      body: JSON.stringify(message) })
    debug('sign %s => %s', ret.status, await ret.text())
  },

  async sendEvent (event, user) {
    if (!settings.settings.enable_federation) {
      console.error(settings.settings)
      console.error(settings.secretSettings)
      debug('federation disabled')
      return
    }

    console.error('dentro sendEvent ', user)

    // event is sent by user that published it and by the admin instance
    // collect followers from admin and user
    const instanceAdmin = await User.findOne({ where: { email: config.admin }, include: { model: FedUsers, as: 'followers'  } })
    if (!instanceAdmin || !instanceAdmin.username) {
      debug('Instance admin not found (there is no user with email => %s)', config.admin)
      return
    }

    console.error(instanceAdmin.followers)
    let recipients = {}
    instanceAdmin.followers.forEach(follower => {
      const sharedInbox = follower.user_followers.endpoints.sharedInbox
      if (!recipients[sharedInbox]) recipients[sharedInbox] = []
      recipients[sharedInbox].push(follower.id)
    })

    for(const sharedInbox in recipients) {
      debug('Notify %s with event %s (from admin user %s) cc => %d', sharedInbox, event.title, instanceAdmin.username, recipients[sharedInbox].length)
      const body = {
        id: `${config.baseurl}/federation/m/${event.id}#create`,
        type: 'Create',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${config.baseurl}/federation/u/${instanceAdmin.username}/followers`, ...recipients[sharedInbox]],
        actor: `${config.baseurl}/federation/u/${instanceAdmin.username}`,
        object: event.toAP(instanceAdmin.username, [`${config.baseurl}/federation/u/${instanceAdmin.username}/followers`, ...recipients[sharedInbox]])
      }
      body['@context'] = 'https://www.w3.org/ns/activitystreams'
      Helpers.signAndSend(body, instanceAdmin, sharedInbox)
    }

    // in case the event is published by the Admin itself do not add user
    if (instanceAdmin.id === user.id) {
      debug('Event published by instance Admin')
      return
    } 
    if (!user.settings.enable_federation || !user.username) {
      debug('Federation disabled for user %d (%s)', user.id, user.username)
      return
    }


    recipients = {}
    user.followers.forEach(follower => {
      const sharedInbox = follower.object.endpoints.sharedInbox
      if (!recipients[sharedInbox]) recipients[sharedInbox] = []
      recipients[sharedInbox].push(follower.id)
    })

    debug(recipients)
    for(const sharedInbox in recipients) {
      debug('Notify %s with event %s (from admin user %s) cc => %d', sharedInbox, event.title, user.username, recipients[sharedInbox].length)
      const body = {
        id: `${config.baseurl}/federation/m/${event.id}#create`,
        type: 'Create',
        to: ['https://www.w3.org/ns/activitystreams#Public'],
        cc: [`${config.baseurl}/federation/u/${user.username}/followers`, ...recipients[sharedInbox]],
        actor: `${config.baseurl}/federation/u/${user.username}`,
        object: event.toAP(user.username, [`${config.baseurl}/federation/u/${user.username}/followers`, ...recipients[sharedInbox]])
      }
      body['@context'] = 'https://www.w3.org/ns/activitystreams'
      Helpers.signAndSend(body, user, sharedInbox)
    }

  },

  // DO NOT USE THIS! (why is this needed btw?)
  // async getFederatedUser (address) {
  //   address = address.trim()
  //   const [ username, host ] = address.split('@')
  //   const url = `https://${host}/.well-known/webfinger?resource=acct:${username}@${host}`
  //   return Helpers.getActor(url)
  // },

  // TODO: cache
  async getActor (url, force = false) {
    let fedi_user
    
    // try with cache first
    if (!force) fedi_user = await FedUsers.findByPk(url)

    if (fedi_user) return fedi_user.object
    fedi_user = await fetch(url, { headers: { 'Accept': 'application/jrd+json, application/json' } })
      .then(res => {
        if (!res.ok) {
          debug('[ERR] Actor %s => %s', url, res.statusText)
          return false
        }
        return res.json()
      })
    if (fedi_user) {
      await FedUsers.create({ap_id: url, object: fedi_user})
    }
    return fedi_user
  },

  // ref: https://blog.joinmastodon.org/2018/07/how-to-make-friends-and-verify-requests/
  async verifySignature (req, res, next) {
    let user = await Helpers.getActor(req.body.actor)
    if (!user) { return res.status(401).send('Actor not found') }
    
    // little hack -> https://github.com/joyent/node-http-signature/pull/83
    req.headers.authorization = 'Signature ' + req.headers.signature
    
    req.fedi_user = user

    // another little hack :/
    // https://github.com/joyent/node-http-signature/issues/87
    req.url = '/federation' + req.url
    const parsed = httpSignature.parseRequest(req)
    if (httpSignature.verifySignature(parsed, user.publicKey.publicKeyPem)) { return next() }
    
    // signature not valid, try without cache
    user = await Helpers.getActor(req.body.actor, true)
    if (!user) { return res.status(401).send('Actor not found') }
    if (httpSignature.verifySignature(parsed, user.publicKey.publicKeyPem)) { return next() }
    
    // still not valid
    debug('Invalid signature from user %s', req.body.actor)
    res.send('Request signature could not be verified', 401)

  }
}

module.exports = Helpers
