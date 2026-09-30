const auth1 = {
  subject: "user:A", // The authorization subject
  operation: "book.read", // Operation to be performed
  resource: ["book:1"], // Path to the resource
  contraints: {
    scope: {
      title: 1,
      description: 1,
    },
    require: {
      owner: "{subject}",
    },
  },
};

const auth2 = {
  subject: "user:B",
  operation: "book.create",
  constraints: {
    require: {
      owner: "{subject}",
    },
  },
};

const authorizations = [auth1, auth2];

const operationsRules = {
  "book.read": () => {
  },
};

function check(request: any) {
  const { authorizations, subject, operation, resource } = request;

  return {
    allowed: true,
    result: { title: "Book 1", description: "A fascinating book" },
  };
}

const checked = check({
  authorizations,
  subject: "user:A",
  operation: "read",
  resource: "book:1",
});
if (checked.allowed) {
  console.log(checked.result);
}
