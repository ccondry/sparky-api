// Begin ECE
const eGainLibrarySettings = require('./egainNode').eGainLibrarySettings
const myLibrarySettings = new eGainLibrarySettings()
myLibrarySettings.CORSHost = process.env.ECE_HOST
myLibrarySettings.IsDevelopmentModeOn = false
myLibrarySettings.eGainContextPath = "./"
/* Next create a new instance of the eGainLibrary */
/* passing in the settings you have just created. */
const eGainLibrary = require('./egainNode').eGainLibrary
const myLibrary = new eGainLibrary(myLibrarySettings)
myLibrary.CORSHost = process.env.ECE_HOST

module.exports = myLibrary
