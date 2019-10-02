import Vue from 'vue'
import moment from 'moment'
// import 'dayjs/locale/it'
// import 'dayjs/locale/es'

export default ({ app, store }) => {
  // replace links with anchors
  // TODO: remove fb tracking id
  Vue.filter('linkify', value => value.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>'))
  Vue.filter('url2host', url => url.match(/^https?:\/\/(.[^/:]+)/i)[1])
  Vue.filter('datetime', value => moment(value).utc(false).locale(store.state.locale).format('ddd, D MMMM HH:mm'))
  // Vue.filter('short_datetime', value => moment(value).locale(store.state.locale).format('D/MM HH:mm'))
  // Vue.filter('hour', value => moment(value).locale(store.state.locale).format('HH:mm'))

  // shown in mobile homepage
  Vue.filter('day', value => moment.unix(value).utc(false).locale(store.state.locale).format('dddd, D MMM'))
  // Vue.filter('month', value => moment(value).locale(store.state.locale).format('MMM'))

  // format event start/end datetime based on page
  Vue.filter('when', (event, where) => {
    moment.locale(store.state.locale)

    // show local time relative to event's place
    // (not where in the worlds I'm looking at the page from)
    const start = moment.unix(event.start_datetime).utc(false)
    const end = moment.unix(event.end_datetime).utc(false)
    
    const normal = `${start.format('dddd, D MMMM (HH:mm-')}${end.format('HH:mm)')}`

    // recurrent event
    if (event.recurrent && where !== 'home') {
      const { frequency, days, type } = JSON.parse(event.recurrent)
      if (frequency === '1w' || frequency === '2w') {
        const recurrent = app.i18n.tc(`event.recurrent_${frequency}_days`, days.length, { days: days.map(d => moment().day(d - 1).format('dddd')) })
        return `${normal} - ${recurrent}`
      } else if (frequency === '1m' || frequency === '2m') {
        const d = type === 'ordinal' ? days : days.map(d => moment().day(d - 1).format('dddd'))
        const recurrent = app.i18n.tc(`event.recurrent_${frequency}_${type}`, days.length, { days: d })
        return `${normal} - ${recurrent}`
      }
      return 'recurrent '
    }

    // multidate
    if (event.multidate) {
      return `${start.format('ddd, D MMMM (HH:mm)')} - ${end.format('ddd, D MMMM')}`
    }

    // normal event
    if (event.end_datetime && event.end_datetime !== event.start_datetime) {
      return `${start.format('ddd, D MMMM (HH:mm-')}${end.format('HH:mm)')}`
    }
    return start.format('dddd, D MMMM (HH:mm)')
  })
}
