/* jshint node: true, esversion: 10, -W014, -W033 */
/* eslint-disable new-cap */
'use strict'

module.exports = class deviceTVSingle {
  constructor (platform, accessory) {
    // Set up variables from the platform
    this.funcs = platform.funcs
    this.hapChar = platform.api.hap.Characteristic
    this.hapErr = platform.api.hap.HapStatusError
    this.hapServ = platform.api.hap.Service
    this.lang = platform.lang
    this.log = platform.log
    this.platform = platform

    // Set up variables from the accessory
    this.accessory = accessory
    this.name = accessory.displayName

    // Set the correct logging variables for this accessory
    this.enableLogging = accessory.context.enableLogging
    this.enableDebugLogging = accessory.context.enableDebugLogging

    // Add the tv service if it doesn't already exist
    this.service =
      this.accessory.getService(this.hapServ.Television) ||
      this.accessory.addService(this.hapServ.Television)

    // Add the set handler to the tv active characteristic
    this.service.getCharacteristic(this.hapChar.Active).onSet(async value => {
      await this.internalUpdate(value)
    })
    this.cacheState = this.service.getCharacteristic(this.hapChar.Active).value === 1 ? 'on' : 'off'

    // Output the customised options to the log
    const opts = JSON.stringify({
      logging: this.enableDebugLogging ? 'debug' : this.enableLogging ? 'standard' : 'disable',
      showAs: 'audio/box/stick'
    })
    this.log('[%s] %s %s.', this.name, this.lang.devInitOpts, opts)
  }

  async internalStateUpdate (value) {
    try {
      const newValue = value === 1 ? 'on' : 'off'

      // Don't continue if the new value is the same as before
      if (newValue === this.cacheState) {
        return
      }

      // Don't continue if the device doesn't support this command
      if (
        this.accessory.context.supportedCmds &&
        !this.accessory.context.supportedCmds.includes('turn')
      ) {
        const eText = this.accessory.context.gvModel + this.lang.notSuppTurn
        throw new Error(eText)
      }

      // Log a message in debug if the device is not currently controllable
      if (!this.cacheOnline && this.enableDebugLogging) {
        this.log('[%s] %s.', this.name, this.lang.devNotControl)
      }

      // Set up a one minute timeout for the plugin to ignore incoming updates
      const timerKey = this.funcs.generateRandomString(5)
      this.updateTimeout = timerKey
      setTimeout(() => {
        if (this.updateTimeout === timerKey) {
          this.updateTimeout = false
        }
      }, 60000)

      // Send the request to the platform sender function
      await this.platform.sendDeviceUpdate(this.accessory, {
        cmd: 'state',
        value: newValue
      })

      // Cache the new state and log if appropriate
      if (this.cacheState !== newValue) {
        this.cacheState = newValue
        if (this.enableLogging) {
          this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
        }
      }
    } catch (err) {
      // Catch any errors during the process
      const eText = this.funcs.parseError(err)
      this.log.warn(
        '[%s] %s %s.',
        this.name,
        this.lang.devNotUpdated,
        eText.includes('p-queue') ? this.lang.timeout : eText
      )

      // Throw a 'no response' error and set a timeout to revert this after 2 seconds
      setTimeout(() => {
        this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)
      }, 2000)
      throw new this.hapErr(-70402)
    }
  }

  externalUpdate (params) {
    // Don't apply the update during the one minute timeout if update is from API
    if (this.updateTimeout) {
      return
    }

    // Check to see if the provided online status is different from the cache value
    if (this.funcs.hasProperty(params, 'online') && this.cacheOnline !== params.online) {
      this.cacheOnline = params.online
      this.platform.updateAccessoryStatus(this.accessory, this.cacheOnline)
    }

    // Check to see if the provided state is different from the cached state
    if (params.state && params.state !== this.cacheState) {
      // State is different so update Homebridge with new values
      this.cacheState = params.state
      this.service.updateCharacteristic(this.hapChar.Active, this.cacheState === 'on' ? 1 : 0)

      // Log the change if appropriate
      if (this.enableLogging) {
        this.log('[%s] %s [%s].', this.name, this.lang.curState, this.cacheState)
      }
    }
  }
}