#代码里玩玩Unicode

## 示例代码

以下所有代码只是大概演示一下相关的思路，细节可以忽略。

### 将对应的字符转换成对应的unicode
```javascript
// 只是处理字符串的，比如说'1'
const getUnicode = word => word.charCodeAt().toString(16).padStart(5, 'u0000');

console.log(getUnicode('o'));
// output: u006f
```

### unicode组成的一段可执行代码

源码是：

```javascript
console.log(100);
```

unicode代码：

```javascript
\u0063\u006f\u006e\u0073\u006f\u006c\u0065.\u006c\u006f\u0067(0x0064)
```

提醒2点：

1. 仅标识符和字符串可以使用unicode；
2. 数字使用16进制表示；

### 用途

自己寻思吧。


## 相关文档

* [Unicode in Javascript source code](https://www.educative.io/answers/how-to-insert-unicode-in-javascript)
* [Unicode-wikipedia](https://zh.wikipedia.org/wiki/Unicode)