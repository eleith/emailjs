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

   html_data: function(email, server, config)
   {
      var path    = require('path');
      var fs      = require('fs');
      var message = email.message.create(
      {
         subject: "this is a test TEXT+HTML+DATA message from emailjs",
         from:    /^.+@.+$/.test(config.username) ? config.username : config.username + '@' + config.host,
         to:      config.email,
         text:    "hello friend if you are seeing this, you can not view html emails. it is attached inline."
      });

      // attach an alternative html email for those with advanced email clients
      message.attach({data:fs.readFileSync(path.join(__dirname, "attachments/smtp.html"), "utf-8"), alternative:true});

      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text+html+data email successfully sent");
      });
   },

   html_file: function(email, server, config)
   {
      var path    = require('path');
      var fs      = require('fs');
      var message = email.message.create(
      {
         subject: "this is a test TEXT+HTML+FILE message from emailjs",
         from:    /^.+@.+$/.test(config.username) ? config.username : config.username + '@' + config.host,
         to:      config.email,
         text:    "hello friend if you are seeing this, you can not view html emails. it is attached inline."
      });

      // attach an alternative html email for those with advanced email clients
      message.attach({path:path.join(__dirname, "attachments/smtp.html"), alternative:true});

      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text+html+file email successfully sent");
      });
   },

   html_embedded_image: function(email, server, config)
   {
      var path    = require('path');
      var fs      = require('fs');
      var message = email.message.create(
      {
         subject: "this is a test TEXT+HTML+IMAGE message from emailjs",
         from:    /^.+@.+$/.test(config.username) ? config.username : config.username + '@' + config.host,
         to:      config.email,
         text:    "hello friend if you are seeing this, you can not view html emails. it is attached inline."
      });

      // attach an alternative html email for those with advanced email clients
      message.attach(
      {
         path:          path.join(__dirname, "attachments/smtp2.html"), 
         alternative:   true,
         related: 
         [
            {
               path:    path.join(__dirname, "attachments/smtp.gif"),
               type:    "image/gif", 
               name:    "smtp-diagram.gif", 
               headers: {"Content-ID":"<smtp-diagram@local>"}
            }
         ]
      });
      //message.attach({path:path.join(__dirname, "attachments/smtp.gif"), type:"image/gif", name:"smtp-diagram.gif", headers:{"Content-ID":"<smtp-diagram@local>"}});

      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text+html+image email successfully sent");
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

      message.attach({path:path.join(__dirname, "attachments/smtp.pdf"), type:"application/pdf", name:"smtp-info.pdf"});

      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text+attachment email successfully sent");
      });
   },

   attachments: function(email, server, config)
   {
      var path    = require('path');
      var fs      = require('fs');
      var message = email.message.create(
      {
         subject: "this is a test TEXT+2+ATTACHMENTS message from emailjs",
         from:    /^.+@.+$/.test(config.username) ? config.username : config.username + '@' + config.host,
         to:      config.email,
         text:    "hello friend, i hope this message and attachments finds you well."
      });

      message.attach({path:path.join(__dirname, "attachments/smtp.pdf"), type:"application/pdf", name:"smtp-info.pdf"});
      message.attach({path:path.join(__dirname, "attachments/postfix-2.8.7.tar.gz"), type:"application/tar-gz", name:"postfix.source.2.8.7.tar.gz"});
      
      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text+2+attachments email successfully sent");
      });
   },

   streams: function(email, server, config)
   {
      var path    = require('path');
      var fs      = require('fs');
      var message = email.message.create(
      {
         subject: "this is a test TEXT+2+STREAMED+ATTACHMENTS message from emailjs",
         from:    /^.+@.+$/.test(config.username) ? config.username : config.username + '@' + config.host,
         to:      config.email,
         text:    "hello friend, i hope this message and streamed attachments finds you well."
      });

      var stream = fs.createReadStream(path.join(__dirname, "attachments/smtp.pdf"));
      stream.pause();
      message.attach({stream:stream, type:"application/pdf", name:"smtp-info.pdf"});

      var stream2 = fs.createReadStream(path.join(__dirname, "attachments/postfix-2.8.7.tar.gz"));
      stream2.pause();
      message.attach({stream:stream2, type:"application/x-gzip", name:"postfix.source.2.8.7.tar.gz"});

      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text+2+streamed+attachments email successfully sent");
      });
   },

   legacy_apis: function(email, server, config)
   {
      var path    = require('path');
      var fs      = require('fs');
      var message = email.message.create(
      {
         subject: "this is a test of legacy API ATTACHMENTS message from emailjs",
         from:    /^.+@.+$/.test(config.username) ? config.username : config.username + '@' + config.host,
         to:      config.email,
         text:    "hello friend, i hope this message and html and attachments finds you well."
      });

      // attach an alternative html email for those with advanced email clients
      message.attach_alternative(fs.readFileSync(path.join(__dirname, "attachments/smtp.html"), "utf-8"));
      message.attach(path.join(__dirname, "attachments/smtp.pdf"), "application/pdf", "smtp-info.pdf");

      server.send(message, function(err, message)
      {
         console.log(err ? err.message : "text+legacy+attachments email successfully sent");
      });
   }

};

for(var test in tests)
   exports[test] = tests[test];
