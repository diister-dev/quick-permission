import * as p from "@dii/quick-permission"

const resourceAction = p.action([p.scope(), p.owner()], [p.allowOwner()])

// user
// group
// userGroup
// article
// -> comment

// # Tables
// - user
// - userPermission
// - group
// - groupPermission
// - userGroup
// - article
// - articlePermission
// - comment
// - commentPermission

// Questions
// - Can I create a comment? (on any article)
// - Can I read a given comment? (on any article)
// - Can I update a given comment? (on any article)
// - Can I delete a given comment? (on any article)
const commentPermHierarchy = p.root({
    create: p.action(),
    read: resourceAction,
    update: p.action([p.owner()], [p.allowOwner()]), // only the owner can update their own comment
    delete: resourceAction,
})

// Questions
// - Can I create an article?
// - Can I read a given article?
// - Can I update a given article?
// - Can I delete a given article?
// - Can I comment on a given article?
// - Can I read a given comment?
// - Can I update a given comment?
// - Can I delete a given comment?
const articlePermHierarchy = p.root({
    create: p.action(),
    read: resourceAction,
    update: resourceAction,
    delete: resourceAction,
    share: resourceAction,
    comment: commentPermHierarchy,
})