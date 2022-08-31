export const PROMOCODE = 'FAST20';

export const formats = [
    {
        id: 'offline',
        title: 'Оффлайн индивидуально',
        description: 'Выберите это обучение, если вы занимаетесь с преподавателем лично - у нас в школе, дома или в офисе',
        types: [
            {
                id: 'russian',
                description: 'Обучение с русскоязычным преподавателем',
                packs: [
                    { id: 1, description: '1 урок', price: 1900 },
                    { id: 2, description: '2 урока', price: 7000 },
                    { id: 8, description: '8 уроков', price: 12800 },
                    { id: 16, description: '16 уроков', price: 24800 }
                ]
            },
            {
                id: 'native',
                description: 'Обучение с носителем языка',
                packs: [
                    { id: 1, description: '1 урок', price: 2150 },
                    { id: 2, description: '2 урока', price: 7800 },
                    { id: 8, description: '8 уроков', price: 14400 },
                    { id: 16, description: '16 уроков', price: 27200 }
                ]
            },
            {
                id: 'prep',
                description: 'Подготовка к экзаменам, специальные курсы, бизнес-курс',
                packs: [
                    { id: 1, description: '1 урок', price: 2150 },
                    { id: 2, description: '2 урока', price: 7800 },
                    { id: 8, description: '8 уроков', price: 14400 },
                    { id: 16, description: '16 уроков', price: 27200 }
                ]
            }
        ]
    },
    {
        id: 'online',
        title: 'Онлайн индивидуально',
        description: 'Выберите это обучение, если вы занимаетесь дистанционно по Скайп',
        types: [
            {
                id: 'russian',
                description: 'Обучение с русскоязычным преподавателем',
                packs: [
                    { id: 5, description: '5 уроков', price: 6500 },
                    { id: 10, description: '10 уроков', price: 12300 },
                    { id: 20, description: '20 уроков', price: 23100 },
                    { id: 40, description: '40 уроков', price: 41200 },
                    { id: 60, description: '60 уроков', price: 57000 }
                ]
            },
            {
                id: 'native',
                description: 'Обучение с носителем языка',
                packs: [
                    { id: 5, description: '5 уроков', price: 9900 },
                    { id: 10, description: '10 уроков', price: 18500 },
                    { id: 20, description: '20 уроков', price: 34100 },
                    { id: 40, description: '40 уроков', price: 66000 },
                    { id: 60, description: '60 уроков', price: 92400 }
                ]
            },
            {
                id: 'children-russian',
                description: 'Детское обучение с русскоязычным преподавателем (25 мин.)',
                packs: [
                    { id: 5, description: '5 уроков', price: 4300 },
                    { id: 10, description: '10 уроков', price: 7400 },
                    { id: 20, description: '20 уроков', price: 13600 },
                    { id: 40, description: '40 уроков', price: 23900 },
                    { id: 60, description: '60 уроков', price: 32500 }
                ]
            },
            {
                id: 'children-native',
                description: 'Детское обучение с носителем языка (25 мин.)',
                packs: [
                    { id: 5, description: '5 уроков', price: 4500 },
                    { id: 10, description: '10 уроков', price: 8500 },
                    { id: 20, description: '20 уроков', price: 16000 },
                    { id: 40, description: '40 уроков', price: 30000 },
                    { id: 60, description: '60 уроков', price: 42000 }
                ]
            },
            {
                id: 'prep-russian',
                description: 'Подготовка к экзаменам, специальные курсы, бизнес-курс (русскоязычный преподаватель)',
                packs: [
                    { id: 5, description: '5 урока', price: 9900 },
                    { id: 10, description: '10 уроков', price: 18500 },
                    { id: 20, description: '20 уроков', price: 34100 },
                    { id: 40, description: '40 урока', price: 66000 }
                ]
            },
            {
                id: 'prep-native',
                description: 'Подготовка к экзаменам, специальные курсы, бизнес-курс (носитель языка)',
                packs: [
                    { id: 5, description: '5 урока', price: 11100 },
                    { id: 10, description: '10 уроков', price: 19900 },
                    { id: 20, description: '20 уроков', price: 36200 },
                    { id: 40, description: '40 урока', price: 69800 }
                ]
            }
        ]
    },
    {
        id: 'online-group',
        title: 'Онлайн в группе',
        description: 'Выберите это обучение, если вы занимаетесь в группе по Zoom',
        packs: [
            { id: 1, description: '1 месяц обучения (8 занятий)', price: 10000 },
            { id: 2, description: '3 месяца обучения (24 занятий)', price: 26700 },
            { id: 3, description: '6 месяца обучения (48 занятия)', price: 43200 }
        ]
    }
];