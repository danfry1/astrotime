// Drop-in replacement for Open MCT's moment-based UTCTimeFormat using astrotime.
// Values are milliseconds since the Unix epoch, as Open MCT expects.
import { formatInstant, instantFromUnixMillis, instantToUnixMillis, parseInstant } from 'astrotime'

const DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss.SSS'
const DATE_FORMATS = {
  PRECISION_DEFAULT: DATE_FORMAT,
  PRECISION_DEFAULT_WITH_ZULU: `${DATE_FORMAT}Z`,
  PRECISION_SECONDS: 'YYYY-MM-DD HH:mm:ss',
  PRECISION_MINUTES: 'YYYY-MM-DD HH:mm',
  PRECISION_DAYS: 'YYYY-MM-DD',
}

export default class UTCTimeFormat {
  key = 'utc'
  DATE_FORMATS = DATE_FORMATS

  format(value, formatString = DATE_FORMATS.PRECISION_DEFAULT_WITH_ZULU) {
    if (value === undefined) return undefined
    return formatInstant(instantFromUnixMillis(value), formatString)
  }

  parse(text) {
    if (typeof text === 'number') return text
    for (const format of Object.values(DATE_FORMATS)) {
      const result = parseInstant(text, { format })
      if (result.ok) return instantToUnixMillis(result.value)
    }
    return Number.NaN
  }

  validate(text) {
    return Object.values(DATE_FORMATS).some((format) => parseInstant(text, { format }).ok)
  }
}
