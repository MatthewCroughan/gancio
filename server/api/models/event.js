module.exports = (sequelize, DataTypes) => {
  const event = sequelize.define('event', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    title: DataTypes.STRING,
    slug: DataTypes.STRING,
    description: DataTypes.TEXT,
    multidate: DataTypes.BOOLEAN,
    start_datetime: {
      type: DataTypes.INTEGER,
      index: true
    },
    end_datetime: {
      type: DataTypes.INTEGER,
      index: true
    },
    image_path: DataTypes.STRING,
    is_visible: DataTypes.BOOLEAN,
    activitypub_id: {
      type: DataTypes.STRING(18),
      index: true
    },
    recurrent: DataTypes.JSON,
    // parent: DataTypes.INTEGER
  }, {})

  event.associate = function (models) {
    event.belongsTo(models.place)
    event.belongsTo(models.user)
    event.belongsToMany(models.tag, { through: 'event_tags' })
    event.belongsToMany(models.notification, { through: 'event_notification' })
    event.hasMany(models.comment)
  }

  return event
}
