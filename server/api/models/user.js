'use strict'
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const util = require('util')
const debug = require('debug')('model:user')

const generateKeyPair = util.promisify(crypto.generateKeyPair)

module.exports = (sequelize, DataTypes) => {
  const user = sequelize.define('user', {
    username: {
      type: DataTypes.STRING,
      unique: { msg: 'error.nick_taken' },
      index: true,
      allowNull: false
    },
    display_name: DataTypes.STRING,
    settings: {
      type: DataTypes.JSON,
      defaultValue: '{}'
    },
    email: {
      type: DataTypes.STRING,
      unique: { msg: 'error.email_taken' },
      index: true,
      allowNull: false
    },
    description: DataTypes.TEXT,
    password: DataTypes.STRING,
    recover_code: DataTypes.STRING,
    is_admin: DataTypes.BOOLEAN,
    is_active: DataTypes.BOOLEAN,
    rsa: DataTypes.JSON
  }, {
    scopes: {
      withoutPassword: {
        attributes: { exclude: ['password', 'recover_code'] }
      }
    }
  })

  user.associate = function (models) {
    // associations can be defined here
    user.hasMany(models.event)
    user.belongsToMany(models.fed_users, { through: 'user_followers', as: 'followers' })
  }

  user.prototype.comparePassword = async function (pwd) {
    if (!this.password) { return false }
    const ret = await bcrypt.compare(pwd, this.password)
    return ret
  }

  user.beforeSave(async (user, options) => {
    if (user.changed('password')) {
      debug('Password for %s modified', user.username)
      const salt = await bcrypt.genSalt(10)
      const hash = await bcrypt.hash(user.password, salt)
      user.password = hash
    }
  })

  user.beforeCreate(async (user, options) => {
    debug('Create a new user => %s', user.username)
    // generate rsa keys
    const rsa = await generateKeyPair('rsa', {
      modulusLength: 4096,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    })
    user.rsa = rsa
  })

  return user
}
