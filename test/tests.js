var tests =
{
   text: function(email, server, config)
   {
      var message = email.message.create(
      {
         subject: "this is a test TEXT message from emailjs",
         from:    /^.+@.+$/.test(config.username) ? config.username : config.username + '@' + config.host,
         to:      config.email,
         text:    "hello friend, i hope this message finds you well."
      });

      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text only email successfully sent");
      });
   },

   html: function(email, server, config)
   {
      var message = email.message.create(
      {
         subject: "this is a test TEXT+HTML message from emailjs",
         from:    /^.+@.+$/.test(config.username) ? config.username : config.username + '@' + config.host,
         to:      config.email,
         text:    "hello friend, i hope this message finds you well."
      });

      // attach an alternative html email for those with advanced email clients
      message.attach_alternative("<html><body> hello <i>friend</i> i hope <b>this</b> <a href='http://github.com/eleith/emailjs'>message</a> finds <b>you</b> well.</body></html>");

      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text+html email successfully sent");
      });
   },

   attachment: function(email, server, config)
   {
      var path    = require('path');
      var message = email.message.create(
      {
         subject: "this is a test TEXT+ATTACHMENT message from emailjs",
         from:    /^.+@.+$/.test(config.username) ? config.username : config.username + '@' + config.host,
         to:      config.email,
         text:    "hello friend, i hope this message and pdf finds you well."
      });

      message.attach(path.join(__dirname, "attachments/The Last Question - Isaac Asimov.pdf"), "application/pdf", "the_last_question.pdf");

      // attach an alternative html email for those with advanced email clients
      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text+attachment email successfully sent");
      });
   }
};

for(test in tests)
   exports[test] = tests[test];
