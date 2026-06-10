import ExceptionsManager from 'react-native/Libraries/Core/ExceptionsManager';

const rejectionTrackingOptions = {
  allRejections: true,
  onUnhandled: (id, rejection) => {
    let message;

    if (rejection === undefined) {
      message = '';
    } else if (Object.prototype.toString.call(rejection) === '[object Error]') {
      message = Error.prototype.toString.call(rejection);
    } else {
      try {
        message = require('pretty-format').format(rejection);
      } catch {
        message = typeof rejection === 'string' ? rejection : JSON.stringify(rejection);
      }
    }

    ExceptionsManager.handleException(
      new Error(`Uncaught (in promise, id: ${id})${message ? `: "${message}"` : ''}`, {
        cause: rejection,
      }),
      false
    );
  },
  onHandled: id => {
    console.warn(
      `Promise rejection handled (id: ${id})\n` +
        'This means you can ignore any previous messages of the form ' +
        `"Uncaught (in promise, id: ${id})"`
    );
  },
};

export default rejectionTrackingOptions;
