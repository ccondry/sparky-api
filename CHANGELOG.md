# Change Log

Dates are in YYYY-MM-DD format


# 2021.3.2-2

### Features
* **WXM Survey:** Log to Webex when WXM survey does have a user ID associated.

### Bug Fixes
* **Survey:** Send WXM and old survey at the same time, so that WXM survey can
still work even if the old one fails.


# 2021.3.2-1

### Bug Fixes
* **Facebook:** Fix issue where bot asks the customer for their user ID twice.


# 2021.3.2

### Features
* **Survey:** Always get user ID so that WXM survey can match survey data to a
user.


# 2021.2.17

### Bug Fixes
* **Egain Library:** Fix typo in eGain base handler.


# 2021.2.16-2

### Bug Fixes
* **WXM Survey:** Fix web chat WXM survey ID.


# 2021.2.16-1

### Bug Fixes
* **WXM Survey:** Fix REST request parameters for sending WXM survey data.


# 2021.2.16

### Features
* **WXM Survey:** Add user ID and agent ID to survey data, when available.


# 2021.2.15-6

### Bug Fixes
* **Facebook:** Filter out command messages that are used for web chat client.
* **WhatsApp:** Filter out command messages that are used for web chat client.
* **SMS:** Filter out command messages that are used for web chat client.


# 2021.2.15-5

### Bug Fixes
* **WXM Survey:** Fix message format of URL redirect command for ECE chat entry
points that send a survey URL.


# 2021.2.15-4

### Bug Fixes
* **WXM Survey:** Fix the send URL redirect command for ECE chat entry points
that send a survey URL.


# 2021.2.15-3

### Features
* **WXM Survey:** Send URL redirect command for ECE chat entry points that send
a survey URL.


# 2021.2.15-2

### Features
* **WXM Survey:** Improve logging of WXM survey action success.


# 2021.2.15-1

### Bug Fixes
* **WXM Survey:** Fix error when sending WXM survey responses.


# 2021.2.15

### Features
* **WXM Survey:** Send survey responses to WXM for UCCX and PCCE demos.


# 2.7.2 (2020-09-01)

### Features
* **Logging:** reduce error logs sent to Webex Teams log space, ignoring errors
when the chat session has ended on the agent side or when the user closes the
customer chat window